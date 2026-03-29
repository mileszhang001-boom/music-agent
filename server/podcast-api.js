/**
 * 豆包播客生成 HTTP API + 内容存储
 *
 * POST /generate        → 生成或返回缓存播客（SSE 流式进度）
 * GET  /list            → 返回所有已存储的播客列表
 * GET  /audio/:file     → 音频文件静态服务
 *
 * 特性：
 * - 同一 URL 去重（直接返回缓存，0 token）
 * - 文章标题/描述自动抓取
 * - mp3 下载到本地持久存储（不依赖豆包 24h CDN）
 */

import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream, createReadStream, statSync } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import WebSocket from 'ws';

const PORT = parseInt(process.argv[2]) || 9001;
const DATA_DIR = '/opt/relay';
const AUDIO_DIR = join(DATA_DIR, 'audio');
const STORE_FILE = join(DATA_DIR, 'podcast-store.json');

// 确保目录存在
mkdirSync(AUDIO_DIR, { recursive: true });

// 豆包 API 配置
const CONFIG = {
  appId:      process.env.DOUBAO_APP_ID      || '',
  accessKey:  process.env.DOUBAO_ACCESS_KEY   || '',
  resourceId: process.env.DOUBAO_RESOURCE_ID  || 'volc.service_type.10050',
  appKey:     process.env.DOUBAO_APP_KEY      || ''
};

const WS_URL = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';
const TIMEOUT = 900000;
const FRAME_HEADER = Buffer.from([0x11, 0x14, 0x10, 0x00]);
const SPEAKERS = [
  'zh_male_dayixiansheng_v2_saturn_bigtts',
  'zh_female_mizaitongxue_v2_saturn_bigtts'
];

// ========== 存储层 ==========

function loadStore() {
  if (!existsSync(STORE_FILE)) return [];
  try { return JSON.parse(readFileSync(STORE_FILE, 'utf-8')); } catch { return []; }
}

function saveStore(store) {
  writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function findByUrl(url) {
  const store = loadStore();
  return store.find(item => item.source_url === url);
}

function addToStore(record) {
  const store = loadStore();
  store.push(record);
  saveStore(store);
}

// ========== 文章元数据抓取 ==========

async function fetchArticleMeta(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });
    const html = await res.text();

    // og:title 优先（微信文章用这个）
    const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1]
                 || html.match(/property="og:title"\s*content="([^"]+)"/i)?.[1];
    const htmlTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const title = (ogTitle || htmlTitle || '').trim().replace(/\s+/g, ' ');

    const desc = (
      html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1] ||
      html.match(/name="description"\s+content="([^"]+)"/i)?.[1] ||
      ''
    ).trim();

    console.log(`[Meta] 标题: ${title.slice(0, 60)}`);
    return { title: title || '播客', desc: desc || '' };
  } catch (err) {
    console.error(`[Meta] 抓取失败: ${err.message}`);
    return { title: '播客', desc: '' };
  }
}

// ========== 音频下载 ==========

async function downloadAudio(audioUrl, filePath) {
  try {
    const res = await fetch(audioUrl, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(res.body, createWriteStream(filePath));
    const stat = statSync(filePath);
    console.log(`[Download] 已保存: ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    return true;
  } catch (err) {
    console.error(`[Download] 失败: ${err.message}`);
    return false;
  }
}

// ========== 二进制帧 ==========

function preFrame(event, payload) {
  const p = Buffer.from(JSON.stringify(payload));
  const evt = Buffer.alloc(4); evt.writeUInt32BE(event);
  const len = Buffer.alloc(4); len.writeUInt32BE(p.length);
  return Buffer.concat([FRAME_HEADER, evt, len, p]);
}

function postFrame(event, sid, payload) {
  const sb = Buffer.from(sid);
  const p = Buffer.from(JSON.stringify(payload));
  const evt = Buffer.alloc(4); evt.writeUInt32BE(event);
  const sidLen = Buffer.alloc(4); sidLen.writeUInt32BE(sb.length);
  const pLen = Buffer.alloc(4); pLen.writeUInt32BE(p.length);
  return Buffer.concat([FRAME_HEADER, evt, sidLen, sb, pLen, p]);
}

function parseEvent(data) {
  const buf = Buffer.from(data);
  if (buf.length < 8) return { eventType: null, payload: {} };
  const mt = (buf[1] >> 4) & 0xF;
  const fl = buf[1] & 0xF;
  const ser = (buf[2] >> 4) & 0xF;

  if (mt === 0xF) {
    const text = buf.toString();
    const i = text.indexOf('{');
    try { return { eventType: -1, payload: i >= 0 ? JSON.parse(text.slice(i)) : { error: 'unknown' } }; }
    catch { return { eventType: -1, payload: { error: 'parse_error' } }; }
  }

  const evt = buf.readUInt32BE(4);
  let off = 8;
  let payload = {};

  if (fl & 0x04) {
    if (buf.length >= off + 4) { const sl = buf.readUInt32BE(off); off += 4 + sl; }
    if (buf.length >= off + 4) {
      const pl = buf.readUInt32BE(off); off += 4;
      if (pl > 0 && buf.length >= off + pl) {
        const pd = buf.slice(off, off + pl);
        if (ser === 1) { try { payload = JSON.parse(pd.toString()); } catch {} }
      }
    }
  }
  return { eventType: evt, payload };
}

// ========== 豆包生成核心 ==========

async function generateWithDoubao(inputUrl, onProgress) {
  const headers = {
    'X-Api-App-Id': CONFIG.appId,
    'X-Api-Access-Key': CONFIG.accessKey,
    'X-Api-Resource-Id': CONFIG.resourceId,
    'X-Api-App-Key': CONFIG.appKey
  };

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers, maxPayload: 50 * 1024 * 1024, handshakeTimeout: 15000 });
    let sessionId = '', rounds = 0, audioBytes = 0;
    let firstRoundText = '';  // 用第一段文案作为标题 fallback
    const t0 = Date.now();
    const timer = setTimeout(() => { ws.close(); reject(new Error('生成超时')); }, TIMEOUT);

    ws.on('open', () => { ws.send(preFrame(1, {})); });

    ws.on('message', (data) => {
      const { eventType, payload } = parseEvent(data);
      if (eventType === -1) { clearTimeout(timer); ws.close(); reject(new Error(`API 错误: ${JSON.stringify(payload)}`)); return; }

      if (eventType === 50) {
        const buf = Buffer.from(data); let o = 8; const sl = buf.readUInt32BE(o); o += 4;
        sessionId = buf.slice(o, o + sl).toString();
        onProgress('connected', {});
        ws.send(postFrame(100, sessionId, {
          input_info: { input_url: inputUrl, return_audio_url: true },
          use_head_music: true, use_tail_music: false,
          audio_config: { format: 'mp3', sample_rate: 24000, speech_rate: 0 },
          speaker_info: { random_order: true, speakers: SPEAKERS }
        }));
      }
      else if (eventType === 150) { onProgress('session_started', {}); }
      else if (eventType === 360) {
        rounds++;
        const text = (payload.text || '').slice(0, 200);
        if (!firstRoundText && text.length > 10) firstRoundText = text;
        onProgress('round_start', { round: rounds, text: text.slice(0, 80) });
      }
      else if (eventType === 361) { audioBytes += Buffer.from(data).length - 20; onProgress('audio_chunk', { audioBytes }); }
      else if (eventType === 363) {
        clearTimeout(timer);
        const meta = payload.meta_info || payload;
        const audioUrl = meta.audio_url || payload.audio_url || '';
        const dur = meta.duration_sec || payload.duration_sec || 0;
        const durationSec = dur > 0 ? Math.round(dur) : Math.round(audioBytes / 12000);
        try { ws.send(postFrame(2, sessionId, {})); } catch {}
        ws.close();
        resolve({ audioUrl, durationSec, rounds, elapsed: Math.round((Date.now() - t0) / 1000), firstRoundText });
      }
      else if (eventType === 152) { clearTimeout(timer); ws.close(); }
    });

    ws.on('error', (err) => { clearTimeout(timer); reject(new Error(`WebSocket: ${err.message}`)); });
    ws.on('close', () => { clearTimeout(timer); });
  });
}

// ========== HTTP Server ==========

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 健康检查
  if (req.method === 'GET' && req.url === '/health') {
    const store = loadStore();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'podcast-api', podcasts: store.length }));
    return;
  }

  // GET /list — 播客列表
  if (req.method === 'GET' && req.url === '/list') {
    const store = loadStore();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.map(({ id, source_url, title, desc, audio_file, duration_sec, created_at, source }) =>
      ({ id, source_url, title, desc, duration_sec, created_at, source, audio_url: `/audio/${audio_file}` })
    )));
    return;
  }

  // GET /audio/:file — 音频文件
  if (req.method === 'GET' && req.url.startsWith('/audio/')) {
    const fileName = req.url.slice(7).split('?')[0];
    const filePath = join(AUDIO_DIR, fileName);
    if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const stat = statSync(filePath);
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    createReadStream(filePath).pipe(res);
    return;
  }

  // POST /generate — 生成或返回缓存
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
      if (!inputUrl) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing url' })); return; }

      // SSE
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const sse = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

      // ── 去重检查 ──
      const cached = findByUrl(inputUrl);
      if (cached) {
        console.log(`[Podcast] 缓存命中: ${cached.title} (${cached.id})`);
        sse('meta', { title: cached.title, desc: cached.desc });
        sse('complete', {
          audioUrl: `/audio/${cached.audio_file}`,
          title: cached.title,
          desc: cached.desc,
          durationSec: cached.duration_sec,
          rounds: 0,
          elapsed: 0,
          cached: true
        });
        res.end();
        return;
      }

      try {
        // ── 抓取文章元数据 ──
        sse('phase', { phase: 1, text: '链接已收到！正在生成播客...' });
        const meta = await fetchArticleMeta(inputUrl);

        // ── 调用豆包生成 ──
        console.log(`[Podcast] 开始生成: ${meta.title}`);
        let firstText = '';
        const result = await generateWithDoubao(inputUrl, (event, info) => {
          if (event === 'session_started') {
            sse('phase', { phase: 2, text: '已开始生成，完成后会提醒您' });
          } else if (event === 'round_start') {
            // 用第一段有意义的文案补充标题（微信文章抓不到标题时）
            if (!firstText && info.text && info.text.length > 10) {
              firstText = info.text;
            }
            sse('progress', { round: info.round, text: info.text });
          } else if (event === 'audio_chunk') {
            sse('progress', { audioKB: Math.round(info.audioBytes / 1024) });
          }
        });

        // 标题优先级：抓取标题 > 从文案提取 > fallback
        const rawText = result.firstRoundText || firstText || '';
        const cleanedText = rawText
          .replace(/^(今天我们(要|来)聊的是|大家好[，。！\s]*|没错[，。！\s]*|嗯[，。！\s]*|那么?[，。！\s]*|好的?[，。！\s]*|然后呢?[，。！\s]*)*/g, '')
          .replace(/^[，。！？、\s]+/, '')
          .trim();
        const finalTitle = (meta.title && meta.title !== '播客') ? meta.title
          : cleanedText.slice(0, 18) || '播客';
        const finalDesc = meta.desc || cleanedText.slice(0, 80);
        sse('meta', { title: finalTitle, desc: finalDesc });

        // ── 下载音频到本地 ──
        const podcastId = `gen_${Date.now()}`;
        const audioFile = `${podcastId}.mp3`;
        const localPath = join(AUDIO_DIR, audioFile);

        if (result.audioUrl) {
          await downloadAudio(result.audioUrl, localPath);
        }

        // ── 写入 store ──
        const record = {
          id: podcastId,
          source_url: inputUrl,
          title: finalTitle,
          desc: finalDesc,
          audio_file: audioFile,
          duration_sec: result.durationSec,
          created_at: new Date().toISOString(),
          source: 'generated'
        };
        addToStore(record);

        console.log(`[Podcast] 完成: ${finalTitle} | ${result.durationSec}s | ${result.rounds} rounds | ${result.elapsed}s`);

        sse('complete', {
          audioUrl: `/audio/${audioFile}`,
          title: finalTitle,
          desc: finalDesc,
          durationSec: result.durationSec,
          rounds: result.rounds,
          elapsed: result.elapsed,
          cached: false
        });
      } catch (err) {
        console.error(`[Podcast] 失败: ${err.message}`);
        sse('error', { message: err.message });
      }

      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  const store = loadStore();
  console.log(`
==============================
  Podcast API Server
  Port: ${PORT}
  Stored: ${store.length} podcasts
  Audio: ${AUDIO_DIR}
==============================
  `);
});
