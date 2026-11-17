// 1s tick: start due probes, push changes, heartbeat SSE, prune old samples.
const { db } = require('./db');
const { RETAIN_DAYS, DAY } = require('./config');
const { rtOf, flush, heartbeat } = require('./state');
const { probe } = require('./probe');

function start() {
  let tick = 0;
  setInterval(() => {
    const now = Date.now();
    for (const m of db.prepare('SELECT * FROM monitors WHERE enabled=1').all()) {
      const r = rtOf(m.id);
      if (!r.running && now - r.last >= m.interval_s * 1000) { r.running = true; r.last = now; probe(m, r).catch(e => console.error('probe failed:', m.name, e.message)).finally(() => { r.running = false; }); }
    }
    flush();
    if (++tick % 15 === 0) heartbeat();
    if (tick % 3600 === 0) db.prepare('DELETE FROM samples WHERE t<?').run(now - RETAIN_DAYS * DAY);
  }, 1000);
}
module.exports = { start };
