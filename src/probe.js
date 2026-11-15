// One HTTP check of one monitor, then record it and alert on state edges.
const { insSample } = require('./db');
const { N } = require('./config');
const { judge, edge } = require('./health');
const { rt, touch } = require('./state');
const { notify } = require('./alerts');

async function probe(m, r) {
  const t0 = performance.now(); let s = { t: Date.now(), ms: 0, s1: 0, s2: 0, status: 0, ok: false, err: '' };
  try {
    const x = await fetch(m.url, { method: m.method, signal: AbortSignal.timeout(m.timeout_ms), redirect: 'follow', headers: { 'user-agent': 'pitwall-monitor' } });
    const t1 = performance.now(); await x.arrayBuffer(); const t2 = performance.now();
    s = { ...s, s1: t1 - t0, s2: t2 - t1, ms: t2 - t0, status: x.status, ok: m.expect_status ? x.status === m.expect_status : x.status < 400 };
  } catch (e) { s.ms = s.s1 = performance.now() - t0; s.err = e.name === 'TimeoutError' ? 'timeout' : 'unreachable'; }
  if (!rt.has(m.id)) return; // deleted mid-probe
  r.h.push(s); if (r.h.length > N) r.h.shift();
  try { insSample.run(m.id, s.t, s.ms, s.s1, s.s2, s.status, s.ok ? 1 : 0); } catch (e) { console.error(e.message); }
  const prev = r.flag; r.flag = judge(r.h); touch();
  const e = edge(prev, r.flag);
  if (e) notify(m, e, e === 'up' ? `back to ${s.ms.toFixed(0)}ms` : s.ok ? `lap ${s.ms.toFixed(0)}ms` : s.status ? 'HTTP ' + s.status : s.err);
}
module.exports = { probe };
