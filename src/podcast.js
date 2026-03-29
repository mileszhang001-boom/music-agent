// 豆包播客 WebSocket 二进制协议（JS 版）
// 移植自 .claude/skills/doubao-podcast/SKILL.md
// MVP 阶段仅预留接口，实时生成功能待豆包 API 凭证补充后启用

const WS_URL = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';
const HEADER = new Uint8Array([0x11, 0x14, 0x10, 0x00]);
const TIMEOUT = 900000; // 15 分钟

// 事件类型常量
const EVT = {
  START_CONNECTION: 1,
  FINISH_CONNECTION: 2,
  CONNECTION_STARTED: 50,
  START_SESSION: 100,
  SESSION_STARTED: 150,
  SESSION_FINISHED: 152,
  USAGE: 154,
  ROUND_START: 360,
  ROUND_RESP: 361,
  ROUND_END: 362,
  PODCAST_END: 363
};

/** 构造 pre-connection 帧（无 session_id） */
function preFrame(event, payload) {
  const pBytes = new TextEncoder().encode(JSON.stringify(payload));
  const buf = new ArrayBuffer(4 + 4 + 4 + pBytes.length);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8.set(HEADER, 0);
  view.setUint32(4, event, false);   // big-endian
  view.setUint32(8, pBytes.length, false);
  u8.set(pBytes, 12);
  return buf;
}

/** 构造 post-connection 帧（含 session_id） */
function postFrame(event, sessionId, payload) {
  const sidBytes = new TextEncoder().encode(sessionId);
  const pBytes = new TextEncoder().encode(JSON.stringify(payload));
  const buf = new ArrayBuffer(4 + 4 + 4 + sidBytes.length + 4 + pBytes.length);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8.set(HEADER, 0);
  view.setUint32(4, event, false);
  view.setUint32(8, sidBytes.length, false);
  u8.set(sidBytes, 12);
  const pOff = 12 + sidBytes.length;
  view.setUint32(pOff, pBytes.length, false);
  u8.set(pBytes, pOff + 4);
  return buf;
}

/** 解析服务端返回帧 */
function parseEvent(data) {
  const u8 = new Uint8Array(data);
  if (u8.length < 8) return { eventType: null, payload: {} };

  const mt = (u8[1] >> 4) & 0xF;   // message_type
  const fl = u8[1] & 0xF;           // flags
  const ser = (u8[2] >> 4) & 0xF;   // serialization

  // 错误帧: message_type = 0xF
  if (mt === 0xF) {
    const text = new TextDecoder().decode(u8);
    const jsonStart = text.indexOf('{');
    try {
      return { eventType: -1, payload: jsonStart >= 0 ? JSON.parse(text.slice(jsonStart)) : { error: 'unknown' } };
    } catch {
      return { eventType: -1, payload: { error: 'parse_error' } };
    }
  }

  const view = new DataView(data);
  const evt = view.getUint32(4, false);
  let off = 8;
  let payload = {};

  if (fl & 0x04) { // 含 session_id
    if (u8.length >= off + 4) {
      const sidLen = view.getUint32(off, false);
      off += 4 + sidLen;
    }
    if (u8.length >= off + 4) {
      const pLen = view.getUint32(off, false);
      off += 4;
      if (pLen > 0 && u8.length >= off + pLen) {
        const pd = u8.slice(off, off + pLen);
        if (ser === 1) { // JSON
          try { payload = JSON.parse(new TextDecoder().decode(pd)); } catch {}
        }
        // ser === 0 → binary audio（MVP 阶段忽略）
      }
    }
  }

  return { eventType: evt, payload };
}

/** 提取 session_id from ConnectionStarted(50) 帧 */
function extractSessionId(data) {
  const view = new DataView(data);
  const u8 = new Uint8Array(data);
  let off = 8;
  if (u8.length >= off + 4) {
    const sidLen = view.getUint32(off, false);
    off += 4;
    if (u8.length >= off + sidLen) {
      return new TextDecoder().decode(u8.slice(off, off + sidLen));
    }
  }
  return null;
}

/**
 * 生成播客（实时路径）
 * @param {string} url - 文章 URL
 * @param {object} callbacks - { onPhase1, onPhase2(estMin), onPhase3(cdnUrl, durationSec), onError(msg) }
 * @returns {Promise<{cdnUrl: string, durationSec: number}>}
 */
export async function generatePodcast(url, callbacks = {}) {
  // TODO: 补充豆包 API 凭证后启用
  // MVP 阶段抛出提示
  throw new Error('实时播客生成功能尚未启用，请使用预设播客');
}

// 导出供测试
export { preFrame, postFrame, parseEvent, extractSessionId, EVT };
