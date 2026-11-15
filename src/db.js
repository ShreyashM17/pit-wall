// SQLite storage: schema, prepared statements, uptime query, one-time seed from v1 targets.json.
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH } = require('./config');
const { cleanMon } = require('./validate');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS monitors(id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'GET',
  interval_s INTEGER NOT NULL DEFAULT 30, timeout_ms INTEGER NOT NULL DEFAULT 5000, expect_status INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS samples(monitor_id INTEGER NOT NULL, t INTEGER NOT NULL, ms REAL, s1 REAL, s2 REAL, status INTEGER, ok INTEGER, PRIMARY KEY(monitor_id, t)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS channels(id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL);`);

const insMon = db.prepare('INSERT INTO monitors(name,url,method,interval_s,timeout_ms,expect_status,enabled) VALUES(:name,:url,:method,:interval_s,:timeout_ms,:expect_status,:enabled)');
const updMon = db.prepare('UPDATE monitors SET name=:name,url=:url,method=:method,interval_s=:interval_s,timeout_ms=:timeout_ms,expect_status=:expect_status,enabled=:enabled WHERE id=:id');
const insSample = db.prepare('INSERT OR REPLACE INTO samples VALUES(?,?,?,?,?,?,?)');
const upQ = db.prepare('SELECT count(*) n, sum(ok) k FROM samples WHERE monitor_id=? AND t>?');
const up = (id, span) => { const r = upQ.get(id, Date.now() - span); return r.n ? 100 * r.k / r.n : null; };

// seed from the old targets.json once, so v1 users keep their list
const seed = path.join(__dirname, '..', 'targets.json');
if (!db.prepare('SELECT 1 FROM monitors').get() && fs.existsSync(seed))
  for (const t of JSON.parse(fs.readFileSync(seed, 'utf8'))) insMon.run(cleanMon(t));

module.exports = { db, insMon, updMon, insSample, up };
