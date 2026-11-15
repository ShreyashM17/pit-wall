// Outbound alerts: Slack / Discord / generic JSON webhook.
const { db } = require('./db');

const payload = (c, text, extra) => c.kind === 'slack' ? { text } : c.kind === 'discord' ? { content: text } : { text, ...extra };
const send = (c, text, extra) => fetch(c.url, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload(c, text, extra)), signal: AbortSignal.timeout(8000) }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); });

function notify(m, kind, info) {
  const text = kind === 'down' ? `🔴 BOX BOX: ${m.name} is degraded (${info}) ${m.url}` : `🟢 ${m.name} recovered (${info})`;
  for (const c of db.prepare('SELECT * FROM channels').all())
    send(c, text, { event: kind, monitor: m.name, url: m.url, info }).catch(e => console.error('alert failed:', c.name, e.message));
}
module.exports = { send, notify };
