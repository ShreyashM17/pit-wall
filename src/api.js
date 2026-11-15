// JSON API under /api/*: monitors and alert channels.
const { db, insMon, updMon } = require('./db');
const { bad, httpUrl, cleanMon } = require('./validate');
const { rt, touch } = require('./state');
const { send } = require('./alerts');

const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw bad('content-type must be application/json'); // blocks cross-site form posts
  let s = ''; for await (const c of req) { s += c; if (s.length > 10000) throw bad('body too large'); }
  try { return JSON.parse(s || '{}'); } catch { throw bad('invalid json'); }
}

async function api(req, res, p) {
  const [, , what, id, sub] = p.split('/'), b = req.method !== 'GET' && req.method !== 'DELETE' && sub !== 'test' ? await body(req) : {};
  if (what === 'monitors' && req.method === 'POST' && !id) { const r = insMon.run(cleanMon(b)); touch(); return json(res, 201, { id: Number(r.lastInsertRowid) }); }
  if (what === 'monitors' && req.method === 'PUT' && id) { updMon.run({ ...cleanMon(b), id: +id }); touch(); return json(res, 200, {}); }
  if (what === 'monitors' && req.method === 'DELETE' && id) {
    rt.delete(+id); db.prepare('DELETE FROM samples WHERE monitor_id=?').run(+id); db.prepare('DELETE FROM monitors WHERE id=?').run(+id); touch(); return json(res, 200, {});
  }
  if (what === 'channels' && req.method === 'POST' && !id) {
    const kind = ['slack', 'discord', 'webhook'].includes(b.kind) ? b.kind : 'webhook';
    db.prepare('INSERT INTO channels(name,kind,url) VALUES(?,?,?)').run(String(b.name || kind).slice(0, 60), kind, httpUrl(b.url)); touch(); return json(res, 201, {});
  }
  if (what === 'channels' && req.method === 'DELETE' && id) { db.prepare('DELETE FROM channels WHERE id=?').run(+id); touch(); return json(res, 200, {}); }
  if (what === 'channels' && sub === 'test' && req.method === 'POST') {
    const c = db.prepare('SELECT * FROM channels WHERE id=?').get(+id); if (!c) throw bad('no such channel');
    try { await send(c, '🏁 Pit Wall test alert: radio check', { event: 'test' }); return json(res, 200, {}); } catch (e) { throw bad('send failed: ' + e.message); }
  }
  json(res, 404, { error: 'not found' });
}
module.exports = { api, json };
