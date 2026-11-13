// Tests for the public booking functions, using an in-memory stand-in for the database.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const PID = '24ad3bf8-e9b0-4686-876c-b32e0a1bc7d4';
const DAY = 864e5;
// Next Monday 11:00 India time, as epoch ms.
function nextMonday11() { let t = Date.now() + DAY; for (;;) { const d = new Date(t + 330 * 60000); if (d.getUTCDay() === 1) { d.setUTCHours(11, 0, 0, 0); return d.getTime() - 330 * 60000; } t += DAY; } }
const START = nextMonday11();
function practice() {
  return { profile: { name: 'Asha Rao', where: 'Online' }, types: [{ id: 'first', name: 'First session', min: 60, fee: 1500 }],
    hours: { 0: [], 1: [['10:00', '13:00']], 2: [], 3: [], 4: [], 5: [], 6: [] }, blocks: [], intake: [{ id: 'age', label: 'How old are you?' }, { id: 'issue', label: 'Describe your issue', private: true }],
    consent: '', settings: { cancelWindow: 24, latePct: 50, room: 'meet.example/room' }, busy: [], tzOff: -330 };
}
const db = { pub: practice(), inbox: [], fail: false };
const fakeClient = {
  async query(sql, params) {
    if (db.fail) { const e = new Error('down'); e.code = 'ECONNREFUSED'; throw e; }
    if (/from public\.practice_public where slug/.test(sql)) return { rows: params[0] === 'asha-rao-24ad3b' ? [{ practitioner_id: PID, data: JSON.parse(JSON.stringify(db.pub)) }] : [] };
    if (/select starts_at, ends_at from public\.booking_inbox/.test(sql)) return { rows: db.inbox.filter((r) => r.kind === 'booking').map((r) => ({ starts_at: r.starts_at, ends_at: r.ends_at })) };
    if (/select 1 from public\.booking_inbox/.test(sql)) return { rows: db.inbox.filter((r) => r.kind === 'booking' && r.starts_at < params[2] && r.ends_at > params[1]).map(() => ({})) };
    if (/insert into public\.booking_inbox/.test(sql)) { const wl = /'waitlist'/.test(sql); db.inbox.push(wl ? { id: params[0], kind: 'waitlist', payload: JSON.parse(params[2]) } : { id: params[0], kind: 'booking', starts_at: params[2], ends_at: params[3], payload: JSON.parse(params[4]) }); return { rows: [] }; }
    if (/from auth\.users/.test(sql)) return { rows: [{ email: 'therapist@example.com' }] };
    return { rows: [] };
  },
  release() {},
};
require.cache[path.resolve(__dirname, '../api/_lib/db.js')] = { id: 'db', filename: 'db', loaded: true, exports: { getPool: () => ({ connect: async () => fakeClient, query: (s, p) => fakeClient.query(s, p) }) } };
const book = require('../api/book.js');
const practiceApi = require('../api/practice.js');
const { confirmationEmail, therapistEmail } = require('../api/_lib/mail.js');

function res() { return { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } }; }
const good = () => ({ t: 'asha-rao-24ad3b', kind: 'booking', fn: 'Ravi', ln: 'Kumar', email: 'ravi@example.com', wa: '98765 43210', type: 'first', start: START, mode: 'Online', answers: { age: '29', issue: 'Sleep', extra: 'ignored' }, agree: true });
const post = async (body) => { const r = res(); await book({ method: 'POST', body }, r); return r; };

test('a valid booking is stored and returned', async () => {
  db.inbox = []; delete process.env.RESEND_API_KEY;
  const r = await post(Object.assign(good(), { fee: 1 }));
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.mail, 'skipped');
  assert.strictEqual(db.inbox.length, 1);
  const a = db.inbox[0].payload;
  assert.strictEqual(a.name, 'Ravi Kumar');
  assert.strictEqual(a.fee, 1500, 'fee comes from the therapist, not the browser');
  assert.strictEqual(a.dur, 60);
  assert.strictEqual(a.wa, '+91 9876543210');
  assert.deepStrictEqual(a.intake.map((q) => q.label), ['How old are you?', 'Describe your issue']);
  assert.strictEqual(a.intake[1].private, true);
});
test('the same slot cannot be booked twice', async () => {
  const r = await post(good());
  assert.strictEqual(r.statusCode, 409);
  assert.strictEqual(db.inbox.length, 1);
});
test('a slot the therapist already has taken is refused', async () => {
  db.inbox = []; db.pub.busy = [[START - 30 * 60000, START + 30 * 60000]];
  assert.strictEqual((await post(good())).statusCode, 409);
  db.pub.busy = [];
});
test('times outside working hours, in blocked time or in the past are refused', async () => {
  db.inbox = [];
  assert.strictEqual((await post(Object.assign(good(), { start: START + 5 * 36e5 }))).statusCode, 409);
  assert.strictEqual((await post(Object.assign(good(), { start: START + DAY }))).statusCode, 409);
  assert.strictEqual((await post(Object.assign(good(), { start: Date.now() - DAY }))).statusCode, 409);
  db.pub.blocks = [{ date: START - 11 * 36e5, from: '10:00', to: '12:00' }];
  assert.strictEqual((await post(good())).statusCode, 409);
  db.pub.blocks = [];
  assert.strictEqual(db.inbox.length, 0);
});
test('bad details are refused', async () => {
  for (const patch of [{ email: 'nope' }, { fn: '' }, { wa: '123' }, { agree: false }, { type: 'gold' }]) {
    assert.strictEqual((await post(Object.assign(good(), patch))).statusCode, 400, JSON.stringify(patch));
  }
  assert.strictEqual(db.inbox.length, 0);
});
test('unknown link gives 404, GET gives 405', async () => {
  assert.strictEqual((await post(Object.assign(good(), { t: 'nobody-000000' }))).statusCode, 404);
  const r = res(); await book({ method: 'GET' }, r); assert.strictEqual(r.statusCode, 405);
});
test('a waitlist request is stored', async () => {
  db.inbox = [];
  const r = await post({ t: 'asha-rao-24ad3b', kind: 'waitlist', fn: 'Mina', ln: 'Shah', wa: '9123456780', days: 'Weekdays', times: 'Mornings', type: 'first' });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(db.inbox[0].payload.name, 'Mina Shah');
});
test('database failure gives 503 without details', async () => {
  db.fail = true; const r = await post(good()); db.fail = false;
  assert.strictEqual(r.statusCode, 503);
  assert.deepStrictEqual(r.body, { ok: false });
});
test('the public page hides the video link and includes pending bookings as taken', async () => {
  db.inbox = []; await post(good());
  const r = res(); await practiceApi({ query: { t: 'asha-rao-24ad3b' } }, r);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.data.settings.room, '');
  assert.deepStrictEqual(r.body.data.busy, [[START, START + 60 * 60000]]);
  assert.ok(!JSON.stringify(r.body).includes('Ravi'), 'no client names on the public page');
  const nf = res(); await practiceApi({ query: { t: 'nobody-000000' } }, nf); assert.strictEqual(nf.statusCode, 404);
});
test('emails are sent through Resend when a key is set, and a mail failure does not undo the booking', async () => {
  db.inbox = []; process.env.RESEND_API_KEY = 'test-key';
  const sent = []; const realFetch = global.fetch;
  global.fetch = async (url, o) => { sent.push({ url, body: JSON.parse(o.body), auth: o.headers.Authorization }); return { ok: true, status: 200 }; };
  let r = await post(good());
  assert.strictEqual(r.body.mail, 'sent');
  assert.strictEqual(sent.length, 2);
  assert.deepStrictEqual(sent[0].body.to, ['ravi@example.com']);
  assert.strictEqual(sent[0].body.reply_to, 'therapist@example.com');
  assert.deepStrictEqual(sent[1].body.to, ['therapist@example.com']);
  assert.ok(!sent[1].body.html.includes('Sleep'), 'intake answers never go in email');
  db.inbox = []; global.fetch = async () => ({ ok: false, status: 500 });
  r = await post(good());
  assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.mail, 'failed'); assert.strictEqual(db.inbox.length, 1);
  global.fetch = realFetch; delete process.env.RESEND_API_KEY;
});
test('confirmation email template has the session details in India time and escapes names', () => {
  const m = confirmationEmail({ clientName: '<b>Ravi</b> Kumar', therapistName: 'Asha Rao', typeName: 'First session', min: 60, start: START, tzOff: -330, mode: 'Online', room: 'meet.example/room', fee: 1500, cancelWindow: 24, latePct: 50 });
  assert.match(m.subject, /Asha Rao/);
  assert.match(m.text, /Monday/); assert.match(m.text, /11:00 am/); assert.match(m.text, /₹1,500/); assert.match(m.text, /https:\/\/meet\.example\/room/);
  assert.ok(!m.html.includes('<b>Ravi</b>'));
  assert.match(therapistEmail({ clientName: 'Ravi Kumar', typeName: 'First session', min: 60, start: START, tzOff: -330 }).subject, /Ravi Kumar/);
});
