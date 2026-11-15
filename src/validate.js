// Input validation / normalisation. Errors carry status 400 so the HTTP layer can return them.
const bad = m => Object.assign(new Error(m), { status: 400 });
function httpUrl(s) {
  let u; try { u = new URL(s); } catch { throw bad('invalid url'); }
  if (!/^https?:$/.test(u.protocol)) throw bad('url must be http(s)');
  return u.href;
}
const num = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || d));
function cleanMon(b) {
  const url = httpUrl(b.url);
  return { name: String(b.name || '').trim().slice(0, 60) || new URL(url).host, url, method: b.method === 'HEAD' ? 'HEAD' : 'GET',
    interval_s: num(b.interval_s, 10, 3600, 30), timeout_ms: num(b.timeout_ms, 1000, 30000, 5000),
    expect_status: num(b.expect_status, 0, 599, 0), enabled: b.enabled === false ? 0 : 1 };
}
module.exports = { bad, httpUrl, cleanMon };
