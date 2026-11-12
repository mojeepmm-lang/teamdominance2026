// TEAM DOMINANCE – خادم اللعب المحلي (Node.js 16+، بدون npm)
// التشغيل:  node server.js        (المنفذ الافتراضي 8080، أو PORT=9000 node server.js)
// الخادم يحسب: الضرر، القتلات، النتيجة، الوقت، إعادة الظهور. حركة اللاعب يرسلها العميل ويُفحص ضد القفز المفاجئ.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const PORT = +process.env.PORT || 8080;
// نفس صناديق الخريطة الموجودة في team-dominance.html: x, z, عرض, عمق, ارتفاع
const B = [[0,0,6,2.5,2.6],[0,-8,2.5,6,2.6],[0,8,2.5,6,2.6],[-9,-4,6,2.5,2.6],[9,4,6,2.5,2.6],[-9,6,2.5,5,2.6],[9,-6,2.5,5,2.6],
 [-17,0,2,8,1.2],[17,0,2,8,1.2],[-14,-12,5,2.5,2.6],[14,12,5,2.5,2.6],[-14,12,4,1.2,1.2],[14,-12,4,1.2,1.2],
 [-5,-14,1.2,4,1.2],[5,14,1.2,4,1.2],[-21,-8,3,3,1.5],[21,8,3,3,1.5],[-21,9,3,3,1.5],[21,-9,3,3,1.5],[4,-3,3,3,1.5],[-4,3,3,3,1.5],[-2,-5,2.4,.8,.9],[2,5,2.4,.8,.9],[12,-1,.8,2.4,.9],
 [-12,-18.6,.7,.7,.9],[-11.2,-18.6,.7,.7,.9],[12,18.6,.7,.7,.9],[11.2,18.6,.7,.7,.9],[-27,17,.7,.7,.9],[27,-17,.7,.7,.9],[-27.8,16.2,.7,.7,.9],[27.8,-16.2,.7,.7,.9]]
 .map(([x, z, w, d, h]) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h }));
const WP = [{ dmg: 26, rate: 100 }, { dmg: 17, rate: 65 }, { dmg: 90, rate: 1000 }]; // يطابق الأسلحة في اللعبة
const HW = 30, HD = 20, MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.fbx': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg' };
const P = new Map(); let nid = 1, host = 0, state = 'lobby', sc = { b: 0, r: 0 }, tl = 600, ot = false, last = Date.now();
const rnd = (a, b) => a + Math.random() * (b - a);

const srv = http.createServer((q, r) => {
  let f = path.basename(decodeURIComponent(q.url.split('?')[0])) || 'team-dominance.html';
  const ext = path.extname(f);
  if (!MIME[ext] || f === 'server.js') { r.writeHead(404); return r.end('404'); }
  fs.readFile(path.join(__dirname, f), (e, d) => {
    if (e) { r.writeHead(404); return r.end('ملف ناقص: ' + f); }
    r.writeHead(200, { 'Content-Type': MIME[ext] }); r.end(d);
  });
});
srv.on('upgrade', (q, s) => {
  const k = q.headers['sec-websocket-key']; if (!k) return s.destroy();
  s.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(k + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  const c = { socket: s, buf: Buffer.alloc(0), id: 0 };
  s.on('data', d => frames(c, d)); s.on('close', () => drop(c)); s.on('error', () => {});
});
function frames(c, d) {
  c.buf = Buffer.concat([c.buf, d]);
  while (c.buf.length >= 2) {
    const b = c.buf, op = b[0] & 15; let len = b[1] & 127, o = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); o = 4; } else if (len === 127) return c.socket.destroy();
    const m = (b[1] & 128) ? 4 : 0; if (b.length < o + m + len) return;
    let p = b.slice(o + m, o + m + len);
    if (m) { const k = b.slice(o, o + 4); p = Buffer.from(p.map((v, i) => v ^ k[i & 3])); }
    c.buf = b.slice(o + m + len);
    if (op === 8) return c.socket.end();
    if (op === 1) { try { onMsg(c, JSON.parse(p.toString())); } catch (e) {} }
  }
}
function send(c, o) {
  const d = Buffer.from(JSON.stringify(o)); if (d.length > 65000) return;
  const h = d.length < 126 ? Buffer.from([0x81, d.length]) : Buffer.from([0x81, 126, d.length >> 8, d.length & 255]);
  try { c.socket.write(Buffer.concat([h, d])); } catch (e) {}
}
const all = o => { for (const p of P.values()) send(p, o); };
function lobby() {
  const list = [...P.values()].map(q => ({ id: q.id, name: q.name, team: q.team, ready: q.ready }));
  for (const p of P.values()) send(p, { t: 'lobby', you: p.id, host, players: list });
}
function rayBox(o, d, x0, x1, y0, y1, z0, z1) {
  let tn = 0, tf = 1e9; const L = [x0, y0, z0], H = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) { if (o[i] < L[i] || o[i] > H[i]) return 1e9; }
    else { let a = (L[i] - o[i]) / d[i], b = (H[i] - o[i]) / d[i]; if (a > b) { const t = a; a = b; b = t; } tn = Math.max(tn, a); tf = Math.min(tf, b); if (tn > tf) return 1e9; }
  }
  return tn;
}
function place(p) { p.x = (p.team === 'b' ? -1 : 1) * rnd(25, 28); p.z = rnd(-15, 15); p.y = 0; p.hp = 100; p.alive = true; p.lt = Date.now(); send(p, { t: 'respawn', x: p.x, z: p.z }); }
function damage(v, s, dm) {
  v.hp -= dm; v.lh = Date.now(); send(s, { t: 'hit' }); send(v, { t: 'dmg', hp: Math.max(0, v.hp) });
  if (v.hp <= 0) { v.alive = false; v.rs = 3; v.d++; s.k++; sc[s.team]++; send(v, { t: 'death' }); if (sc.b >= 40 || sc.r >= 40 || (ot && sc.b !== sc.r)) endMatch(); }
}
function endMatch() {
  if (state !== 'play') return; state = 'lobby';
  all({ t: 'end', sc, win: sc.b > sc.r ? 'b' : sc.r > sc.b ? 'r' : 'x' });
  for (const p of P.values()) p.ready = false; lobby();
}
function onMsg(c, m) {
  switch (m.t) {
    case 'join': {
      if (c.id) return;
      const bad = s => { send(c, { t: 'err', m: s }); setTimeout(() => c.socket.end(), 200); };
      if (state !== 'lobby') return bad('المباراة جارية');
      const team = m.team === 'r' ? 'r' : 'b';
      if ([...P.values()].filter(p => p.team === team).length >= 4) return bad('الفريق ممتلئ (4 لاعبين كحد أقصى)');
      Object.assign(c, { id: nid++, name: String(m.name || 'لاعب').slice(0, 12), team, ready: false, x: 0, y: 0, z: 0, yaw: 0, hp: 100, alive: true, rs: 0, k: 0, d: 0, lf: 0, lh: 0, lt: 0 });
      P.set(c.id, c); if (!host) host = c.id; send(c, { t: 'welcome', id: c.id }); lobby(); break;
    }
    case 'ready': if (c.id && state === 'lobby') { c.ready = !!m.v; lobby(); } break;
    case 'start': {
      if (c.id !== host || state !== 'lobby') return;
      const ps = [...P.values()], nb = ps.filter(p => p.team === 'b').length, nr = ps.length - nb;
      if (!nb || !nr) return send(c, { t: 'err', m: 'يلزم لاعب واحد على الأقل في كل فريق' });
      if (ps.some(p => p.id !== host && !p.ready)) return send(c, { t: 'err', m: 'ليس كل اللاعبين جاهزين' });
      sc = { b: 0, r: 0 }; tl = 600; ot = false; state = 'play'; last = Date.now();
      all({ t: 'go' }); for (const p of ps) { p.k = p.d = 0; place(p); } break;
    }
    case 'st': {
      if (state !== 'play' || !c.alive) return;
      const { x, y, z, yaw } = m; if (![x, y, z, yaw].every(Number.isFinite)) return;
      const now = Date.now(), dt = Math.min(1, (now - c.lt) / 1000);
      if (Math.hypot(x - c.x, z - c.z) > 12 * dt + 1.5) return send(c, { t: 'respawn', x: c.x, z: c.z }); // رفض القفز المفاجئ
      c.lt = now; c.x = Math.max(-HW, Math.min(HW, x)); c.z = Math.max(-HD, Math.min(HD, z)); c.y = Math.max(0, Math.min(8, y)); c.yaw = yaw; break;
    }
    case 'fire': {
      if (state !== 'play' || !c.alive) return;
      const w = WP[m.w | 0]; if (!w) return;
      const now = Date.now(); if (now - c.lf < w.rate * 0.7) return; c.lf = now;
      let d = m.d; if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return;
      const n = Math.hypot(...d) || 1; d = d.map(v => v / n);
      const o = [c.x, c.y + 1.6, c.z]; let bt = 90, hit = null;
      for (const b of B) { const t = rayBox(o, d, b.x0, b.x1, 0, b.h, b.z0, b.z1); if (t < bt) bt = t; }
      for (const e of P.values()) if (e.alive && e.team !== c.team) { const t = rayBox(o, d, e.x - .35, e.x + .35, e.y, e.y + 1.85, e.z - .35, e.z + .35); if (t < bt) { bt = t; hit = e; } }
      if (hit) damage(hit, c, w.dmg * (o[1] + d[1] * bt > hit.y + 1.5 ? 2 : 1));
      break;
    }
  }
}
function drop(c) {
  if (!c.id) return; P.delete(c.id);
  if (host === c.id) host = P.size ? P.keys().next().value : 0;
  if (!P.size) { state = 'lobby'; sc = { b: 0, r: 0 }; }
  lobby();
}
setInterval(() => {
  if (state !== 'play') return;
  const now = Date.now(), dt = Math.min(.2, (now - last) / 1000); last = now;
  for (const p of P.values()) {
    if (!p.alive) { p.rs -= dt; if (p.rs <= 0) place(p); }
    else if (p.hp < 100 && now - p.lh > 5000) p.hp = Math.min(100, p.hp + 12 * dt);
  }
  if (!ot) { tl -= dt; if (tl <= 0) { tl = 0; if (sc.b === sc.r) ot = true; else return endMatch(); } }
  all({ t: 'snap', sc, tl: Math.round(tl * 10) / 10, ot, p: [...P.values()].map(p => [p.id, p.team, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), Math.round(p.hp), p.alive ? 1 : 0, p.k, p.d]) });
}, 50);
srv.listen(PORT, '0.0.0.0', () => {
  console.log('خادم هيمنة الفريق يعمل. افتح من الأجهزة على نفس الشبكة:');
  for (const l of Object.values(os.networkInterfaces())) for (const a of l) if (a.family === 'IPv4' && !a.internal) console.log('  http://' + a.address + ':' + PORT);
});
