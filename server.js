// Pit Wall entry point: wires auth, routes and the scheduler. Logic lives in src/ (see KNOWLEDGE.md).
const http = require('http'), fs = require('fs'), path = require('path');
const { PASS, HOST, PORT } = require('./src/config');
const { authed } = require('./src/auth');
const { api, json } = require('./src/api');
const { subscribe } = require('./src/state');
const scheduler = require('./src/scheduler');

const PUBLIC = path.join(__dirname, 'public'); // the front end: index.html, styles.css, app.js
const PUBLIC_FILES = new Set(fs.readdirSync(PUBLIC));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

http.createServer(async (req, res) => {
  let p; try { p = new URL(req.url, 'http://x').pathname; } catch { res.writeHead(400); return res.end(); } // e.g. "GET //" throws; must not crash the server
  if (p === '/healthz') return res.end('ok'); // before auth: load balancers and Docker probe without credentials
  if (!authed(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Pit Wall"' }); return res.end(); }
  try {
    if (req.method === 'GET' && p === '/events') return subscribe(req, res);
    if (p.startsWith('/api/')) return await api(req, res, p);
    const name = p === '/' ? 'index.html' : p.slice(1);
    if (!PUBLIC_FILES.has(name)) { res.writeHead(404); return res.end(); } // whitelist = no path traversal
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] }); res.end(fs.readFileSync(path.join(PUBLIC, name)));
  } catch (e) { if (!e.status) console.error(e); json(res, e.status || 500, { error: e.status ? e.message : 'server error' }); }
}).listen(PORT, HOST, () => console.log(`Pit Wall on http://${HOST}:${PORT}${PASS ? ' (password protected)' : ' (local only, no password)'}`));

scheduler.start();
