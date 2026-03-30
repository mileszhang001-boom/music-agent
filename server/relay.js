/**
 * 轻量 WebSocket 中继服务器
 *
 * 用法: node server/relay.js [port]
 * 默认端口: 9000
 *
 * 连接: ws://IP:9000?room=ROOM_ID&role=phone|car
 * 同一 room 内的连接互相广播消息。
 *
 * 诊断: 通过 HTTP GET 访问同一端口
 *   GET /          → 房间状态总览
 *   GET /room/:id  → 单个房间详情
 *   GET /test/:id  → 向房间发送测试消息
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const PORT = parseInt(process.argv[2]) || 9000;
const rooms = new Map(); // roomId → Map<ws, {role, connectedAt, ip, msgCount}>

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

// ========== HTTP 诊断接口 ==========

const httpServer = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // GET / — 所有房间状态
  if (req.url === '/' || req.url === '/status') {
    const status = {};
    for (const [roomId, peers] of rooms) {
      status[roomId] = {
        peers: peers.size,
        clients: [...peers.values()].map(info => ({
          role: info.role,
          ip: info.ip,
          connectedAt: info.connectedAt,
          msgSent: info.msgSent,
          msgReceived: info.msgReceived,
          uptime: Math.round((Date.now() - new Date(info.connectedAt).getTime()) / 1000) + 's'
        }))
      };
    }
    res.end(JSON.stringify(status, null, 2));
    return;
  }

  // GET /test/:roomId — 发送测试消息到房间
  const testMatch = req.url.match(/^\/test\/(.+)/);
  if (testMatch) {
    const roomId = decodeURIComponent(testMatch[1]);
    const room = rooms.get(roomId);
    if (!room) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `房间 "${roomId}" 不存在或无连接` }));
      return;
    }
    const testMsg = JSON.stringify({
      type: 'content',
      session_id: `test_diag_${Date.now()}`,
      timestamp: new Date().toISOString(),
      user_profile: { persona_id: 'diag', persona_label: '诊断测试' },
      payload: { text: '这是一条诊断测试消息，如果车端收到请回传 ACK' }
    });
    let sent = 0;
    for (const [ws, info] of room) {
      if (ws.readyState === 1) {
        ws.send(testMsg);
        sent++;
        console.log(`[${ts()}] [DIAG] 测试消息 → ${info.role} (${info.ip})`);
      }
    }
    res.end(JSON.stringify({ ok: true, roomId, sentTo: sent, message: '测试消息已发送，查看日志确认是否收到 ACK' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found. Try / or /test/car_001' }));
});

// ========== WebSocket 中继 ==========

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.searchParams.get('room') || 'default';
  const role = url.searchParams.get('role') || 'unknown';
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress || '';

  // 加入房间
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  const room = rooms.get(roomId);
  const clientInfo = { role, ip, connectedAt: new Date().toISOString(), msgSent: 0, msgReceived: 0 };
  room.set(ws, clientInfo);

  console.log(`[${ts()}] [+] ${role} joined "${roomId}" from ${ip} (${room.size} peers)`);

  // 通知房间内其他人
  broadcast(room, ws, JSON.stringify({
    type: '_relay_event', event: 'peer_joined', role, peers: room.size
  }));

  // 转发消息
  ws.on('message', (data) => {
    clientInfo.msgSent++;
    const msgStr = data.toString();

    // 解析消息类型用于日志
    let msgType = '?';
    try { msgType = JSON.parse(msgStr).type || '?'; } catch {}

    const delivered = broadcast(room, ws, data);
    console.log(`[${ts()}] [${roomId}] ${role}(${ip}) → ${delivered} peers | type=${msgType} | ${msgStr.slice(0, 100)}`);

    // 特别标记 ACK
    if (msgType !== '_relay_event' && msgStr.includes('"status"')) {
      console.log(`[${ts()}] [${roomId}] ✅ ACK from ${role}: ${msgStr.slice(0, 200)}`);
    }
  });

  // 断开
  ws.on('close', (code, reason) => {
    room.delete(ws);
    console.log(`[${ts()}] [-] ${role} left "${roomId}" (code=${code}) | sent=${clientInfo.msgSent} | ${room.size} peers left`);

    broadcast(room, ws, JSON.stringify({
      type: '_relay_event', event: 'peer_left', role, peers: room.size
    }));

    if (room.size === 0) rooms.delete(roomId);
  });

  ws.on('error', (err) => {
    console.log(`[${ts()}] [!] ${role} error in "${roomId}": ${err.message}`);
  });

  // 告知连接者当前房间状态
  ws.send(JSON.stringify({
    type: '_relay_event', event: 'connected', room: roomId, role, peers: room.size
  }));
});

function broadcast(room, sender, data) {
  let count = 0;
  for (const [ws] of room) {
    if (ws !== sender && ws.readyState === 1) {
      ws.send(data);
      const info = room.get(ws);
      if (info) info.msgReceived++;
      count++;
    }
  }
  return count;
}

httpServer.listen(PORT, () => {
  console.log(`
==============================
  WebSocket Relay Server
  Port: ${PORT}

  诊断接口（HTTP）:
    GET /           房间状态
    GET /test/:room 发送测试消息

  WebSocket:
    ws://host:${PORT}?room=ROOM&role=phone|car
==============================
  `);
});
