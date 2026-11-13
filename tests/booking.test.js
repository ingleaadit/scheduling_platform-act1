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
  return { profile: { name: 'Asha Rao', where: 'Online' }, types: [{ id: 'first', name: 'First session', min: 60, fee: 1500 }, { id: 'follow', name: 'Follow-up session', min: 50, fee: 1500 }],
    hours: { 0: [], 1: [['10:00', '13:00']], 2: [], 3: [], 4: [], 5: [], 6: [] }, blocks: [], intake: [{ id: 'age', label: 'How old are you?' }, { id: 'issue', label: 'Describe your issue', private: true }],
    consent: '', settings: { cancelWindow: 24, latePct: 50, room: 'meet.example/room', upi: 'asha@okaxis' }, busy: [], tzOff: -330 };
}
const { makeFakeDb } = require('./fake-db');
const { db, pool } = makeFakeDb('asha-rao-24ad3b', PID);
db.pub = practice();
require.cache[path.resolve(__dirname, '../api/_lib/db.js')] = { id: 'db', filename: 'db', loaded: true, exports: { getPool: () => pool } };
const book = require('../api/book.js');
const practiceApi = require('../api/practice.js');
const manage = require('../api/manage.js');
const { confirmationEmail, therapistEmail, changeEmail } = require('../api/_lib/mail.js');

function res() { return { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } }; }
const good = () => ({ t: 'asha-rao-24ad3b', kind: 'booking', fn: 'Ravi', ln: 'Kumar', email: 'ravi@example.com', wa: '98765 43210', type: 'first', start: START, mode: 'Online', answers: { age: '29', issue: 'Sleep', extra: 'ignored' }, agree: true });
const post = async (body, ip) => { const r = res(); await book({ method: 'POST', body, headers: { 'x-forwarded-for': ip || '' } }, r); return r; };
const mg = async (body) => { const r = res(); await manage({ method: 'POST', body, headers: {} }, r); return r; };
const mgPaid = async (m, utr) => mg(Object.assign({}, m, { action: 'paid', utr }));
const mgGet = async (query) => { const r = res(); await manage({ method: 'GET', query, headers: {} }, r); return r; };

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
  assert.strictEqual(r.body.data.settings.upi, 'asha@okaxis', 'the UPI id is meant to be public');
  assert.deepStrictEqual(r.body.data.busy, [[START, START + 60 * 60000]]);
  assert.ok(!JSON.stringify(r.body).includes('token'), 'no keys on the public page');
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
  assert.ok(!sent[0].body.html.includes('Reschedule or cancel'), 'no manage link unless the site address is configured');
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

// ---- spam protection ----
test('a filled hidden field is accepted silently and nothing is stored', async () => {
  db.inbox = [];
  const r = await post(Object.assign(good(), { hp: 'http://spam.example' }));
  assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.appt, undefined); assert.strictEqual(db.inbox.length, 0);
});
test('one visitor is limited to a few requests an hour, others are not affected', async () => {
  db.inbox = []; db.pub.hours[1] = [['07:00', '22:00']];
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await post(Object.assign(good(), { start: START - 4 * 36e5 + i * 36e5, email: `p${i}@example.com` }), '203.0.113.9')).statusCode);
  assert.deepStrictEqual(codes, [200, 200, 200, 200, 200, 200, 429, 429]);
  assert.strictEqual((await post(Object.assign(good(), { start: START + 8 * 36e5, email: 'other@example.com' }), '198.51.100.7')).statusCode, 200);
  assert.ok(db.inbox.every((r) => !/203\.0\.113/.test(r.ip_hash || '')), 'address is stored only as a hash');
  db.pub.hours[1] = [['10:00', '13:00']];
});
test('the same email cannot hold more than three new bookings a day', async () => {
  db.inbox = []; db.pub.hours[1] = [['07:00', '22:00']];
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await post(Object.assign(good(), { start: START - 4 * 36e5 + i * 36e5 }), '192.0.2.' + i)).statusCode);
  assert.deepStrictEqual(codes, [200, 200, 200, 429]);
  db.pub.hours[1] = [['10:00', '13:00']];
});
test('a therapist-wide hourly cap stops a flood from many addresses', async () => {
  db.inbox = []; db.limit = { hour_all: 40, hour_ip: 0, day_email: 0 };
  assert.strictEqual((await post(good())).statusCode, 429);
  db.limit = null;
});

// ---- client changes ----
async function freshBooking() { db.inbox = []; db.pub = practice(); const r = await post(good()); return { b: r.body.manage.b, k: r.body.manage.k, t: 'asha-rao-24ad3b' }; }
test('the private link shows the booking; a wrong key or id shows nothing', async () => {
  const m = await freshBooking();
  const r = await mgGet(m);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.booking.start, START); assert.strictEqual(r.body.booking.name, 'Ravi'); assert.strictEqual(r.body.booking.status, 'upcoming');
  assert.ok(!JSON.stringify(r.body).includes('Sleep'), 'intake answers are never returned');
  assert.strictEqual((await mgGet(Object.assign({}, m, { k: 'wrong-key' }))).statusCode, 404);
  assert.strictEqual((await mgGet(Object.assign({}, m, { b: '00000000-0000-4000-8000-000000000000' }))).statusCode, 404);
  assert.strictEqual((await mg(Object.assign({}, m, { k: 'wrong-key', action: 'cancel' }))).statusCode, 404);
  assert.ok(db.inbox[0].token_hash && db.inbox[0].token_hash !== m.k, 'only a hash of the key is stored');
});
test('cancelling early is free, frees the slot and leaves a change for the console', async () => {
  const m = await freshBooking();
  const r = await mg(Object.assign({}, m, { action: 'cancel', reason: 'Unwell' }));
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.booking.status, 'cancelled'); assert.strictEqual(r.body.booking.lateFee, 0);
  const ch = db.inbox.find((x) => x.kind === 'cancel');
  assert.strictEqual(ch.payload.apptId, 'b' + m.b); assert.strictEqual(ch.payload.reason, 'Unwell');
  assert.strictEqual((await mg(Object.assign({}, m, { action: 'cancel' }))).statusCode, 409, 'cannot cancel twice');
  assert.strictEqual((await post(Object.assign(good(), { email: 'next@example.com' }))).statusCode, 200, 'the slot can be booked again');
});
test('cancelling inside the window applies the late fee from the therapist’s policy', async () => {
  const m = await freshBooking();
  db.inbox[0].starts_at = new Date(Date.now() + 2 * 36e5).toISOString();
  const r = await mg(Object.assign({}, m, { action: 'cancel' }));
  assert.strictEqual(r.body.booking.late, true); assert.strictEqual(r.body.booking.lateFee, 750);
});
test('moving to a free time works; taken, closed and late moves are refused', async () => {
  const m = await freshBooking();
  db.pub.busy = [[START + 60 * 60000, START + 120 * 60000]];
  assert.strictEqual((await mg(Object.assign({}, m, { action: 'reschedule', start: START + 60 * 60000 }))).body.error, 'slot');
  assert.strictEqual((await mg(Object.assign({}, m, { action: 'reschedule', start: START + 6 * 36e5 }))).body.error, 'slot');
  db.pub.busy = [];
  const r = await mg(Object.assign({}, m, { action: 'reschedule', start: START + 30 * 60000 }));
  assert.strictEqual(r.statusCode, 200, 'may overlap their own old time');
  assert.strictEqual(r.body.booking.start, START + 30 * 60000);
  const ch = db.inbox.find((x) => x.kind === 'reschedule');
  assert.strictEqual(ch.payload.start, START + 30 * 60000);
  assert.strictEqual((await post(Object.assign(good(), { email: 'next@example.com', start: START + 60 * 60000 }))).statusCode, 409, 'the new time is held');
  db.inbox[0].starts_at = new Date(Date.now() + 2 * 36e5).toISOString();
  assert.strictEqual((await mg(Object.assign({}, m, { action: 'reschedule', start: START + 60 * 60000 }))).body.error, 'late');
});
test('change emails say what happened and carry no intake answers', () => {
  const c = changeEmail({ kind: 'cancelled', clientName: 'Ravi', therapistName: 'Asha Rao', typeName: 'First session', min: 60, start: START, tzOff: -330, lateFee: 750 });
  assert.match(c.subject, /cancelled/); assert.match(c.text, /₹750/);
  const mv = changeEmail({ kind: 'moved', forTherapist: true, clientName: 'Ravi', therapistName: 'Asha Rao', typeName: 'First session', min: 60, start: START + 36e5, oldStart: START, tzOff: -330 });
  assert.match(mv.subject, /Ravi moved/); assert.match(mv.text, /12:00 pm/); assert.match(mv.text, /11:00 am/);
});
test('the manage link goes in the confirmation email only from the configured site address', async () => {
  db.inbox = []; db.pub = practice(); process.env.RESEND_API_KEY = 'k'; process.env.SITE_URL = 'https://book.example';
  const sent = []; const realFetch = global.fetch; global.fetch = async (u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200 }; };
  const r = await book({ method: 'POST', body: good(), headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } }, res());
  global.fetch = realFetch; delete process.env.RESEND_API_KEY; delete process.env.SITE_URL;
  assert.match(sent[0].html, /https:\/\/book\.example\/\?t=asha-rao-24ad3b&amp;b=/);
  assert.ok(!sent[0].html.includes('evil.example'));
  assert.ok(!sent[1].html.includes('&amp;k='), 'the therapist’s copy has no client key');
});

// ---- follow-ups, payments, placeholder name ----
test('a follow-up booking stores no first-session answers and needs none', async () => {
  db.inbox = []; db.pub = practice();
  const r = await post(Object.assign(good(), { type: 'follow', answers: { age: '29', issue: 'Should not be stored' }, guardian: { name: 'X', rel: 'Y', wa: '9' } }));
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(db.inbox[0].payload.intake, null);
  assert.strictEqual(db.inbox[0].payload.guardian, null);
  assert.strictEqual(db.inbox[0].payload.dur, 50);
  assert.ok(!JSON.stringify(db.inbox[0]).includes('Should not be stored'));
});
test('a first booking still keeps its intake answers', async () => {
  db.inbox = []; await post(good());
  assert.strictEqual(db.inbox[0].payload.intake.length, 2);
});
test('a client can report a UPI payment; it reaches the therapist as a claim, never as paid', async () => {
  const m = await freshBooking();
  assert.strictEqual((await mgPaid(m, '12345')).statusCode, 400, 'UTR must be 12 digits');
  const r = await mgPaid(m, '123456789012');
  assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.booking.claimed, true);
  const claim = db.inbox.find((x) => x.kind === 'payment');
  assert.strictEqual(claim.payload.utr, '123456789012'); assert.strictEqual(claim.payload.apptId, 'b' + m.b);
  assert.ok(!('paid' in claim.payload), 'a client cannot mark a session paid');
  assert.strictEqual((await mgPaid(Object.assign({}, m, { k: 'wrong' }), '123456789012')).statusCode, 404);
  assert.strictEqual((await mgPaid(m, '')).statusCode, 200, 'the UTR is optional');
});
test('a payment cannot be reported for a cancelled session', async () => {
  const m = await freshBooking();
  await mg(Object.assign({}, m, { action: 'cancel' }));
  assert.strictEqual((await mgPaid(m, '123456789012')).statusCode, 409);
});
test('emails do not print the UPI id next to the fee, and say "your therapist" while the name is still the placeholder', async () => {
  db.inbox = []; db.pub = practice(); db.pub.profile.name = 'Your name'; db.pub.settings.room = ''; process.env.RESEND_API_KEY = 'k';
  const sent = []; const realFetch = global.fetch; global.fetch = async (u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200 }; };
  await post(good());
  global.fetch = realFetch; delete process.env.RESEND_API_KEY;
  assert.ok(!/asha@okaxis/.test(sent[0].html + sent[0].text), 'no UPI id in the email');
  assert.match(sent[0].text, /by UPI after the session/);
  assert.match(sent[0].text, /Your therapist will send the video link/);
  assert.ok(!/Your will/.test(sent[0].html + sent[0].text));
  assert.match(sent[0].subject, /with your therapist is booked/);
  db.pub.profile.name = 'Asha Rao';
});
test('payment email names the client and asks the therapist to check the bank', () => {
  const { paymentEmail } = require('../api/_lib/mail.js');
  const m = paymentEmail({ clientName: 'Ravi', fee: 1500, start: START, tzOff: -330, utr: '123456789012' });
  assert.match(m.subject, /Ravi says they paid ₹1,500/); assert.match(m.text, /Check your bank/); assert.match(m.text, /123456789012/);
});
