// Pure health logic: no I/O, so it is unit-testable.
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

// Health rule over the recent window: 'box' (red) / 'slow' (yellow) / 'ok'
function judge(h) {
  if (!h.length) return 'ok';
  const last = h[h.length - 1], m = med(h.filter(s => s.ok).map(s => s.ms));
  if (h.length >= 3 && h.slice(-3).every(s => !s.ok)) return 'box';
  if (h.length >= 5 && h.filter(s => !s.ok).length / h.length > 0.2) return 'box';
  if (last.ok && m && h.length >= 5 && last.ms > 2 * m) return 'box';
  if (!last.ok || (m && last.ms > 1.5 * m)) return 'slow'; // ponytail: one failure = yellow only
  return 'ok';
}
// Alert only on edges: entering red = 'down', leaving red = 'up'. Debounce comes from judge() needing 3 fails.
const edge = (a, b) => a !== 'box' && b === 'box' ? 'down' : a === 'box' && b !== 'box' ? 'up' : null;

module.exports = { med, judge, edge };
