// Shared-password HTTP Basic auth. Refuses network exposure without a password.
const crypto = require('crypto');
const { PASS, HOST } = require('./config');

if (!PASS && !['127.0.0.1', 'localhost'].includes(HOST)) { console.error(`Refusing to listen on ${HOST} without ADMIN_PASSWORD`); process.exit(1); }
if (PASS && PASS.length < 12 && !['127.0.0.1', 'localhost'].includes(HOST)) { console.error('ADMIN_PASSWORD must be at least 12 characters when exposed to a network'); process.exit(1); }
const sha = s => crypto.createHash('sha256').update(s).digest();
const authed = req => {
  if (!PASS) return true; // local-only mode (see HOST check above)
  const d = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
  return crypto.timingSafeEqual(sha(d.slice(d.indexOf(':') + 1)), sha(PASS));
};
module.exports = { authed };
