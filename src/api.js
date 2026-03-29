// 通信层 — 自动连接中继 WebSocket + Mock 降级
import { ACK_TIMEOUT } from './config.js';

// 中继地址从环境变量读取（Vite 构建时注入）
const RELAY_URL = import.meta.env.VITE_RELAY_URL || '';

let ws = null;
let connected = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 10000;
const pendingAcks = new Map();
const connectionListeners = new Set();

// ========== 连接状态 ==========

/** @returns {'connected'|'connecting'|'disconnected'|'mock'} */
export function getConnectionStatus() {
  if (!RELAY_URL) return 'mock';
  if (connected) return 'connected';
  if (ws && ws.readyState === WebSocket.CONNECTING) return 'connecting';
  return 'disconnected';
}

export function getRelayUrl() {
  return RELAY_URL;
}

export function onConnectionChange(fn) {
  connectionListeners.add(fn);
  return () => connectionListeners.delete(fn);
}

function notifyConnectionChange() {
  connectionListeners.forEach(fn => fn(getConnectionStatus()));
}

// ========== 自动连接 ==========

export function initConnection() {
  if (!RELAY_URL) {
    console.log('[API] 未配置 VITE_RELAY_URL，使用 Mock 模式');
    notifyConnectionChange();
    return;
  }
  connect();
}

function connect() {
  if (ws) {
    ws.onclose = null;  // 阻止旧连接触发重连
    ws.close();
  }

  const url = RELAY_URL + (RELAY_URL.includes('?') ? '&' : '?') + 'role=phone';
  console.log('[API] 连接中继:', url);
  notifyConnectionChange();

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error('[API] WebSocket 创建失败:', err);
    scheduleReconnect();
    return;
  }

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }

    // 中继系统事件
    if (msg.type === '_relay_event') {
      if (msg.event === 'connected') {
        connected = true;
        reconnectAttempt = 0;
        console.log(`[API] 已连接，房间: ${msg.room}，当前 ${msg.peers} 人`);
        notifyConnectionChange();
      } else if (msg.event === 'peer_joined') {
        console.log(`[API] 车端已加入 (${msg.peers} peers)`);
        notifyConnectionChange();
      } else if (msg.event === 'peer_left') {
        console.log(`[API] 车端已离开 (${msg.peers} peers)`);
        notifyConnectionChange();
      }
      return;
    }

    // ACK 消息（车端回传）
    if (msg.status && msg.session_id) {
      const pending = pendingAcks.get(msg.session_id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(msg);
        pendingAcks.delete(msg.session_id);
      }
    }
  };

  ws.onclose = () => {
    connected = false;
    notifyConnectionChange();
    flushPendingAcks('连接断开');
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose 会紧随其后触发，这里不重复处理
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempt++;
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempt - 1), MAX_RECONNECT_DELAY);
  console.log(`[API] ${delay / 1000}s 后重连 (第 ${reconnectAttempt} 次)`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function flushPendingAcks(reason) {
  for (const [sid, pending] of pendingAcks) {
    clearTimeout(pending.timer);
    pending.resolve({ status: 'error', session_id: sid, message: reason });
  }
  pendingAcks.clear();
}

// ========== 发送 + 等待 ACK ==========

export async function sendAndWaitAck(jsonData) {
  // 未连接中继时使用 Mock
  if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
    return mockSendAndWaitAck(jsonData);
  }

  try {
    ws.send(JSON.stringify(jsonData));
    console.log('[API] 发送:', jsonData.type, jsonData.session_id);

    const ack = await waitForAck(jsonData.session_id);
    return { success: ack.status === 'ok', message: ack.message || '' };
  } catch (err) {
    return { success: false, message: err.message || '发送失败' };
  }
}

function waitForAck(sessionId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAcks.delete(sessionId);
      resolve({ status: 'error', session_id: sessionId, message: 'ACK 超时' });
    }, ACK_TIMEOUT);
    pendingAcks.set(sessionId, { resolve, timer });
  });
}

// ========== Mock ==========

function mockSendAndWaitAck(jsonData) {
  console.log('[Mock] 发送:', JSON.stringify(jsonData, null, 2));
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ success: true, message: '推荐已更新' });
    }, 2000);
  });
}
