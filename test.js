// Run: node test.js. Covers the pure logic only (no DB, no network).
const a = require('assert'), { judge, edge } = require('./src/health'), { httpUrl } = require('./src/validate');
const s = (ms, ok = true) => ({ ms, ok });
a.equal(judge([s(100), s(100), s(100), s(100), s(100)]), 'ok');
a.equal(judge([s(100), s(100), s(100), s(100), s(160)]), 'slow');
a.equal(judge([s(100), s(100), s(100), s(100), s(250)]), 'box');
a.equal(judge([s(100), s(0, false), s(0, false), s(0, false)]), 'box');
a.equal(edge('ok', 'box'), 'down'); a.equal(edge('box', 'slow'), 'up'); a.equal(edge('box', 'box'), null); a.equal(edge('ok', 'slow'), null);
a.throws(() => httpUrl('ftp://x.com')); a.throws(() => httpUrl('nope'));
console.log('tests ok');
