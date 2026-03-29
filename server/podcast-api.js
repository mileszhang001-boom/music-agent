/**
 * 豆包播客生成 HTTP API
 *
 * POST /generate  → SSE 流式返回进度 → 最终返回 cdn_url
 *
 * 从 Python generate_podcast.py 移植到 Node.js
 * 浏览器不能设 WebSocket Header，所以由服务端代理连接豆包 API
 */

import { createServer } from 'http';
import WebSocket from 'ws';

const PORT = parseInt(process.argv[2]) || 9001;

// 豆包 API 配置（从环境变量读取）
const CONFIG = {
  appId:      process.env.DOUBAO_APP_ID      || '',
  accessKey:  process.env.DOUBAO_ACCESS_KEY   || '',
  resourceId: process.env.DOUBAO_RESOURCE_ID  || 'volc.service_type.10050',
  appKey:     process.env.DOUBAO_APP_KEY      || ''
};

const WS_URL = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';
const TIMEOUT = 900000; // 15 分钟
const HEADER = Buffer.from([0x11, 0x14, 0x10, 0x00]);

const SPEAKERS = [
  'zh_male_dayixiansheng_v2_saturn_bigtts',
  'zh_female_mizaitongxue_v2_saturn_bigtts'
];

// ========== 二进制帧构造/解析 ==========

function preFrame(event, payload) {
  const p = Buffer.from(JSON.stringify(payload));
  const evt = Buffer.alloc(4); evt.writeUInt32BE(event);
  const len = Buffer.alloc(4); len.writeUInt32BE(p.length);
  return Buffer.concat([HEADER, evt, len, p]);
}

function postFrame(event, sid, payload) {
  const sb = Buffer.from(sid);
  const p = Buffer.from(JSON.stringify(payload));
  const evt = Buffer.alloc(4); evt.writeUInt32BE(event);
  const sidLen = Buffer.alloc(4); sidLen.writeUInt32BE(sb.length);
  const pLen = Buffer.alloc(4); pLen.writeUInt32BE(p.length);
  return Buffer.concat([HEADER, evt, sidLen, sb, pLen, p]);
}

function parseEvent(data) {
  const buf = Buffer.from(data);
  if (buf.length < 8) return { eventType: null, payload: {} };

  const mt = (buf[1] >> 4) & 0xF;
  const fl = buf[1] & 0xF;
  const ser = (buf[2] >> 4) & 0xF;

  if (mt === 0xF) {
    const text = buf.toString();
    const jsonStart = text.indexOf('{');
    try {
      return { eventType: -1, payload: jsonStart >= 0 ? JSON.parse(text.slice(jsonStart)) : { error: 'unknown' } };
    } catch { return { eventType: -1, payload: { error: 'parse_error' } }; }
  }

  const evt = buf.readUInt32BE(4);
  let off = 8;
  let payload = {};

  if (fl & 0x04) {
    if (buf.length >= off + 4) {
      const sidLen = buf.readUInt32BE(off);
      off += 4 + sidLen;
    }
    if (buf.length >= off + 4) {
      const pLen = buf.readUInt32BE(off);
      off += 4;
      if (pLen > 0 && buf.length >= off + pLen) {
        const pd = buf.slice(off, off + pLen);
        if (ser === 1) {
          try { payload = JSON.parse(pd.toString()); } catch {}
        }
        // ser === 0 → binary audio (不需要处理，我们等 cdn_url)
      }
    }
  }

  return { eventType: evt, payload };
}

// ========== 播客生成核心 ==========

async function generatePodcast(inputUrl, onProgress) {
  const headers = {
    'X-Api-App-Id': CONFIG.appId,
    'X-Api-Access-Key': CONFIG.accessKey,
    'X-Api-Resource-Id': CONFIG.resourceId,
    'X-Api-App-Key': CONFIG.appKey
  };

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, {
      headers,
      maxPayload: 50 * 1024 * 1024,
      handshakeTimeout: 15000
    });

    let sessionId = '';
    let rounds = 0;
    let audioBytes = 0;
    const startTime = Date.now();

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`超时 ${TIMEOUT / 1000}s`));
    }, TIMEOUT);

    ws.on('open', () => {
      onProgress('connecting', { elapsed: (Date.now() - startTime) / 1000 });
      ws.send(preFrame(1, {}));
    });

    ws.on('message', (data) => {
      const { eventType, payload } = parseEvent(data);

      if (eventType === -1) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`API 错误: ${JSON.stringify(payload)}`));
        return;
      }

      if (eventType === 50) { // ConnectionStarted
        const buf = Buffer.from(data);
        let off = 8;
        const sidLen = buf.readUInt32BE(off); off += 4;
        sessionId = buf.slice(off, off + sidLen).toString();
        onProgress('connected', { sessionId, elapsed: (Date.now() - startTime) / 1000 });

        // StartSession with URL
        const sessionPayload = {
          input_info: { input_url: inputUrl, return_audio_url: true },
          use_head_music: true,
          use_tail_music: false,
          audio_config: { format: 'mp3', sample_rate: 24000, speech_rate: 0 },
          speaker_info: { random_order: true, speakers: SPEAKERS }
        };
        ws.send(postFrame(100, sessionId, sessionPayload));
      }

      else if (eventType === 150) { // SessionStarted
        onProgress('session_started', { elapsed: (Date.now() - startTime) / 1000 });
      }

      else if (eventType === 360) { // RoundStart
        rounds++;
        const text = (payload.text || '').slice(0, 80);
        onProgress('round_start', { round: rounds, text, elapsed: (Date.now() - startTime) / 1000 });
      }

      else if (eventType === 361) { // RoundResp (audio chunk)
        audioBytes += (Buffer.from(data).length - 20); // rough estimate
        onProgress('audio_chunk', { audioBytes, elapsed: (Date.now() - startTime) / 1000 });
      }

      else if (eventType === 363) { // PodcastEnd — 核心！
        clearTimeout(timeout);
        console.log('[Podcast] PodcastEnd raw payload:', JSON.stringify(payload));
        // duration_sec 可能在 payload 顶层或 meta_info 内
        const meta = payload.meta_info || payload;
        const audioUrl = meta.audio_url || payload.audio_url || '';
        const durationSec = meta.duration_sec || payload.duration_sec || 0;
        // 如果 duration_sec 仍为 0，根据音频大小估算（96kbps = 12KB/s）
        const estimatedDuration = durationSec > 0 ? durationSec : Math.round(audioBytes / 12000);
        onProgress('podcast_end', { audioUrl, durationSec: estimatedDuration, rounds, elapsed: (Date.now() - startTime) / 1000 });

        // 立即关闭，不等 SessionFinished(152)！
        try { ws.send(postFrame(2, sessionId, {})); } catch {}
        ws.close();
        resolve({ audioUrl, durationSec: estimatedDuration, rounds, elapsed: Math.round((Date.now() - startTime) / 1000) });
      }

      else if (eventType === 152) { // SessionFinished
        clearTimeout(timeout);
        ws.close();
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket: ${err.message}`));
    });

    ws.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

// ========== HTTP Server ==========

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'podcast-api' }));
    return;
  }

  // POST /generate
  if (req.method === 'POST' && req.url === '/generate') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let params;
      try { params = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const inputUrl = params.url;
      if (!inputUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing url field' }));
        return;
      }

      // SSE 流式响应
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        console.log(`[Podcast] 开始生成: ${inputUrl}`);
        sendEvent('phase', { phase: 1, text: '链接已收到！正在生成播客...' });

        const result = await generatePodcast(inputUrl, (event, info) => {
          if (event === 'session_started') {
            sendEvent('phase', { phase: 2, text: '已开始生成，完成后会提醒您', elapsed: info.elapsed });
          } else if (event === 'round_start') {
            sendEvent('progress', { round: info.round, text: info.text });
          } else if (event === 'audio_chunk') {
            sendEvent('progress', { audioKB: Math.round(info.audioBytes / 1024) });
          }
        });

        console.log(`[Podcast] 生成完成: ${result.durationSec}s, ${result.rounds} rounds, ${result.elapsed}s`);
        sendEvent('complete', {
          audioUrl: result.audioUrl,
          durationSec: result.durationSec,
          rounds: result.rounds,
          elapsed: result.elapsed
        });
      } catch (err) {
        console.error(`[Podcast] 生成失败: ${err.message}`);
        sendEvent('error', { message: err.message });
      }

      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`
==============================
  Podcast API Server
  Port: ${PORT}
  POST /generate  {url: "..."}
==============================
  `);
});
