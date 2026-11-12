const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const handler = require('../api/db-health.js');

function res() { return { statusCode: 200, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(m) { this.body = m || ''; return this; } }; }
function req(method = 'GET') { const r = new EventEmitter(); r.method = method; return r; }

test('returns 405 for POST', async () => {
  const r = res(); await handler(req('POST'), r); assert.strictEqual(r.statusCode, 405);
});
test('returns 500 when DATABASE_URL is missing', async () => {
  delete process.env.DATABASE_URL;
  const r = res(); await handler(req(), r); assert.strictEqual(r.statusCode, 500);
  assert.ok(!r.body.includes('postgres'), 'must not echo connection details');
});
test('returns 503 without leaking details when the database is unreachable', async () => {
  process.env.DATABASE_URL = 'postgresql://user:secret@127.0.0.1:1/none';
  const r = res(); await handler(req(), r);
  assert.strictEqual(r.statusCode, 503);
  assert.ok(!r.body.includes('secret'));
});
