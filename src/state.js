// In-memory runtime state + what gets pushed to browsers over SSE.
const { db, up } = require('./db');
const { N, DAY } = require('./config');
const { med, judge } = require('./health');

const rt = new Map();               // monitor id -> { h: recent samples, flag, last probe time, running }
const clients = new Set();          // open SSE responses
let dirty = false;
const touch = () => { dirty = true; };   // call whenever something a browser should see changed

function rtOf(id) {
  if (!rt.has(id)) {
    const h = db.prepare('SELECT t,ms,s1,s2,status,ok FROM samples WHERE monitor_id=? ORDER BY t DESC LIMIT ?').all(id, N).reverse().map(s => ({ ...s, ok: !!s.ok }));
    rt.set(id, { h, flag: judge(h), last: 0, running: false });
  }
  return rt.get(id);
}

const snapshot = () => ({
  monitors: db.prepare('SELECT * FROM monitors ORDER BY id').all().map(m => {
    const r = rtOf(m.id), h = r.h, ok = h.filter(s => s.ok), ms = ok.map(s => s.ms).sort((a, b) => a - b);
    return { ...m, flag: !m.enabled ? 'paused' : h.length ? r.flag : 'pending', last: h[h.length - 1] || null,
      up24: up(m.id, DAY), up7: up(m.id, 7 * DAY), up30: up(m.id, 30 * DAY),
      p50: med(ms), p95: ms[Math.floor(ms.length * 0.95)] || 0, best: ms[0] || 0,
      bestS1: ok.length ? Math.min(...ok.map(s => s.s1)) : 0, bestS2: ok.length ? Math.min(...ok.map(s => s.s2)) : 0,
      spark: h.map(s => s.ok ? Math.round(s.ms) : -1) };
  }),
  channels: db.prepare('SELECT id,name,kind,url FROM channels ORDER BY id').all().map(c => ({ id: c.id, name: c.name, kind: c.kind, host: new URL(c.url).host })), // never send webhook tokens back
});

const flush = () => { if (!dirty) return; dirty = false; if (!clients.size) return; const d = `data: ${JSON.stringify(snapshot())}\n\n`; clients.forEach(c => c.write(d)); };
const heartbeat = () => clients.forEach(c => c.write(':\n\n'));
function subscribe(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  clients.add(res); req.on('close', () => clients.delete(res)); res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
}
module.exports = { rt, rtOf, touch, flush, heartbeat, subscribe };
