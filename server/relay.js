/**
 * 轻量 WebSocket 中继服务器
 *
 * 用法: node server/relay.js [port]
 * 默认端口: 9000
 *
 * 连接: ws://IP:9000?room=ROOM_ID
 * 同一 room 内的连接互相广播消息，自己不收到自己发的。
 *
 * 手机端和车端连同一个 room 即可通信：
 *   手机: ws://192.168.x.x:9000?room=car_001
 *   车端: ws://192.168.x.x:9000?room=car_001
 */

import { WebSocketServer } from 'ws';

const PORT = parseInt(process.argv[2]) || 9000;
const rooms = new Map(); // roomId → Set<ws>

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.searchParams.get('room') || 'default';
  const role = url.searchParams.get('role') || 'unknown'; // 'phone' | 'car'

  // 加入房间
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  const room = rooms.get(roomId);
  room.add(ws);

  const peerCount = room.size;
  console.log(`[+] ${role} joined room "${roomId}" (${peerCount} peers)`);

  // 通知房间内其他人有新连接
  broadcast(room, ws, JSON.stringify({
    type: '_relay_event',
    event: 'peer_joined',
    role,
    peers: peerCount
  }));

  // 转发消息
  ws.on('message', (data) => {
    const msgStr = data.toString();
    console.log(`[${roomId}] ${role} → (${room.size - 1} peers): ${msgStr.slice(0, 120)}...`);
    broadcast(room, ws, data);
  });

  // 断开
  ws.on('close', () => {
    room.delete(ws);
    console.log(`[-] ${role} left room "${roomId}" (${room.size} peers)`);

    broadcast(room, ws, JSON.stringify({
      type: '_relay_event',
      event: 'peer_left',
      role,
      peers: room.size
    }));

    if (room.size === 0) rooms.delete(roomId);
  });

  // 告知连接者当前房间状态
  ws.send(JSON.stringify({
    type: '_relay_event',
    event: 'connected',
    room: roomId,
    role,
    peers: peerCount
  }));
});

function broadcast(room, sender, data) {
  for (const peer of room) {
    if (peer !== sender && peer.readyState === 1) {
      peer.send(data);
    }
  }
}

console.log(`
==============================
  WebSocket Relay Server
  Port: ${PORT}
  URL:  ws://localhost:${PORT}?room=ROOM_ID&role=phone|car
==============================
`);
