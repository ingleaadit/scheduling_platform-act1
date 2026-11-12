const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const handler = require('../api/razorpay-webhook.js');
const { verifySignature } = handler;

const SECRET = 'test_secret_123';
const body = JSON.stringify({ event: 'payment_link.paid', event_id: 'evt_1', payload: { payment: { entity: { id: 'pay_1', method: 'upi' } } } });
const sign = (b, s = SECRET) => crypto.createHmac('sha256', s).update(b, 'utf8').digest('hex');

function fakeReq({ method = 'POST', headers = {}, payload = '' } = {}) {
  const req = new EventEmitter();
  req.method = method; req.headers = headers;
  process.nextTick(() => { req.emit('data', Buffer.from(payload)); req.emit('end'); });
  return req;
}
function fakeRes() {
  return { statusCode: 200, body: '', end(m) { this.body = m || ''; return this; } };
}

test('accepts a correctly signed body', () => {
  assert.strictEqual(verifySignature(body, sign(body), SECRET), true);
});
test('rejects a body changed after signing', () => {
  assert.strictEqual(verifySignature(body.replace('pay_1', 'pay_2'), sign(body), SECRET), false);
});
test('rejects a signature made with another secret', () => {
  assert.strictEqual(verifySignature(body, sign(body, 'other'), SECRET), false);
});
test('rejects missing signature or secret', () => {
  assert.strictEqual(verifySignature(body, undefined, SECRET), false);
  assert.strictEqual(verifySignature(body, sign(body), ''), false);
});
test('rejects a signature of the wrong length without throwing', () => {
  assert.strictEqual(verifySignature(body, 'abc', SECRET), false);
});

test('handler returns 200 for a valid signed event', async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  const res = fakeRes();
  await handler(fakeReq({ headers: { 'x-razorpay-signature': sign(body) }, payload: body }), res);
  assert.strictEqual(res.statusCode, 200);
});
test('handler returns 400 for a bad signature', async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  const res = fakeRes();
  await handler(fakeReq({ headers: { 'x-razorpay-signature': 'bad' }, payload: body }), res);
  assert.strictEqual(res.statusCode, 400);
});
test('handler returns 500 when the secret is not set', async () => {
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  const res = fakeRes();
  await handler(fakeReq({ headers: { 'x-razorpay-signature': sign(body) }, payload: body }), res);
  assert.strictEqual(res.statusCode, 500);
});
test('handler returns 405 for GET', async () => {
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET' }), res);
  assert.strictEqual(res.statusCode, 405);
});
