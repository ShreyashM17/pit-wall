// Env-driven settings and shared constants.
const path = require('path');
module.exports = {
  PASS: process.env.ADMIN_PASSWORD, HOST: process.env.HOST || '127.0.0.1', PORT: process.env.PORT || 3000,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pitwall.db'),
  N: 60,              // samples kept in memory per monitor (judge window + sparkline)
  DAY: 864e5, RETAIN_DAYS: 31,
};
