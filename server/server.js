#!/usr/bin/env node
/* =====================================================================
 * ARKEON · G2 · server/server.js
 * Бесплатный авторитетный сервер на чистом Node (stdio/stdlib, без npm):
 *   · HTTP: раздаёт mobile/ как игру, /data/ как канон, /health как статус;
 *   · WS  : RFC 6455 handshake + framing вручную на /ws;
 *   · SIM : 30 Гц тик / 20 Гц снапшоты / AOI / античит / чат / группа.
 *
 * Запуск:  node server/server.js            → http://0.0.0.0:8080/
 *          PORT=9000 node server/server.js
 * Телефон в той же Wi-Fi: http://<IP компа>:8080/  (WS на том же origin).
 * В облаке: за TLS-прокси адрес wss://<host>/ws вводится в игре.
 * ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sim = require('./sim.js');

const ROOT = path.resolve(__dirname, '..');
const MOBILE = path.join(ROOT, 'mobile');
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg',
  '.md':'text/markdown; charset=utf-8', '.csv':'text/csv; charset=utf-8',
  '.sql':'text/plain; charset=utf-8', '.ico':'image/x-icon'
};

function safePath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '' || p === '/mobile' || p === '/mobile/') p = '/mobile/index.html';
  else if (!p.startsWith('/mobile/') && !p.startsWith('/data/') && p !== '/health') {
    p = '/mobile' + p;                 // /index.html, /js/..., /css/... → внутри mobile/
  }
  const abs = path.resolve(ROOT, '.' + p);
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url.startsWith('/health?')) {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({ok:true, ...sim.stats()}, null, 2));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method Not Allowed'); return; }
  const abs = safePath(req.url);
  if (!abs) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('404 · '+req.url); return; }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control':'no-cache',
      'Access-Control-Allow-Origin':'*',
      'Service-Worker-Allowed':'/'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(abs).pipe(res);
  });
});

/* --------------------------- WebSocket (RFC 6455) --------------------------- */
server.on('upgrade', (req, socket, head) => {
  const url = (req.url || '').split('?')[0];
  if (url !== '/ws' && url !== '/mobile/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  if (sim.players.size >= sim.A2.C.MAX_PLAYERS) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); socket.destroy(); return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n' +
    '\r\n'
  );
  socket.setNoDelay(true);
  let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
  let frag = Buffer.alloc(0), fragOp = 0;
  let player = null;

  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = !!(b0 & 0x80), opcode = b0 & 0x0f;
      const masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { socket.destroy(); return; }
      let mask = null;
      if (masked) { if (buf.length < off + 4) return; mask = buf.slice(off, off + 4); off += 4; }
      if (buf.length < off + len) return;
      let payload = Buffer.from(buf.slice(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.slice(off + len);

      if (opcode === 0x8) { socket.end(); return; }
      if (opcode === 0x9) { sendRaw(socket, 0xA, payload); continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x0) { frag = Buffer.concat([frag, payload]); if (!fin) continue; payload = frag; frag = Buffer.alloc(0); opcode = fragOp; }
      else if (!fin) { frag = payload; fragOp = opcode; continue; }
      if (opcode !== 0x1) continue;

      let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
      if (!player) {
        if (msg.t !== 'hello') continue;
        player = sim.addPlayer(socket, msg);
        sim.send(socket, { t:'welcome', uid:player.uid, zone:player.zone,
          players:Array.from(sim.players.values()).filter(p=>p.zone===player.zone).map(p=>({
            uid:p.uid,name:p.name,classId:p.classId,level:p.level,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,zone:p.zone
          })) });
        sim.syncInitial(player);
        sim.log(player.name+' подключился · игроков: '+sim.players.size);
        sim.broadcast({t:'chat',ch:'local',name:'СЕРВЕР',text:player.name+' вошёл в мир',color:'#4fd6d0'});
      } else {
        sim.handle(player, msg);
      }
    }
  });
  const cleanup = () => { if (player) sim.removePlayer(player.uid); };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
  socket.setTimeout(120000, () => { /* молчаливые клиенты не отключаем: пинг приходит раз в 5 с */ });
});

function sendRaw(socket, opcode, payload) {
  const p = Buffer.from(payload || '');
  const head = p.length < 126 ? Buffer.from([0x80 | opcode, p.length])
    : (() => { const h = Buffer.alloc(4); h[0] = 0x80 | opcode; h[1] = 126; h.writeUInt16BE(p.length, 2); return h; })();
  try { socket.write(Buffer.concat([head, p])); } catch (e) {}
}

sim.start();
server.listen(PORT, HOST, () => {
  console.log('=== ARKEON · G2 Authoritative Server ===');
  console.log('HTTP  http://' + HOST + ':' + PORT + '/');
  console.log('WS    ws://' + HOST + ':' + PORT + '/ws');
  console.log('HEALTH http://' + HOST + ':' + PORT + '/health');
  console.log('Канон: mobile/js/data.js + world.js через vm · 30 Гц тик / 20 Гц снапшоты');
  console.log('Игроков сейчас: ' + sim.players.size);
});
module.exports = { server };
