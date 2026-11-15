// Pit Wall entry point: wires auth, routes and the scheduler. Logic lives in src/ (see KNOWLEDGE.md).
const http = require('http'), fs = require('fs'), path = require('path');
const { PASS, HOST, PORT } = require('./src/config');
const { authed } = require('./src/auth');
const { api, json } = require('./src/api');
const { subscribe } = require('./src/state');
const scheduler = require('./src/scheduler');

http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/healthz') return res.end('ok'); // before auth: load balancers and Docker probe without credentials
  if (!authed(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Pit Wall"' }); return res.end(); }
  try {
    if (req.method === 'GET' && p === '/events') return subscribe(req, res);
    if (p.startsWith('/api/')) return await api(req, res, p);
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  } catch (e) { if (!e.status) console.error(e); json(res, e.status || 500, { error: e.status ? e.message : 'server error' }); }
}).listen(PORT, HOST, () => console.log(`Pit Wall on http://${HOST}:${PORT}${PASS ? ' (password protected)' : ' (local only, no password)'}`));

scheduler.start();
