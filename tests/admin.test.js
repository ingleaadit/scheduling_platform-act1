// Tests for the admin API: only a signed-in person listed in public.admins gets in, and every opening of a therapist is recorded.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ADMIN = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222', T1 = '33333333-3333-4333-8333-333333333333';
const state = { admins: [ADMIN], audit: [], tokens: { 'admin-token-aaaaaaaaaaaaaaaa': { id: ADMIN, email: 'me@example.com' }, 'other-token-bbbbbbbbbbbbbbbbb': { id: OTHER, email: 'x@example.com' } } };
const blob = { profile: { name: 'Asha Rao' }, settings: { plan: 'Free', cancelWindow: 24, latePct: 50 }, clients: [{ name: 'Ravi K', email: 'r@example.com' }], waitlist: [{ id: 'w1' }],
  appts: [{ id: 'a1', name: 'Ravi K', status: 'upcoming', start: 1 }, { id: 'a2', name: 'Meena', status: 'held', start: 2 }, { id: 'x0', name: '', status: 'upcoming', start: 3 }] };
const client = {
  async query(sql, p = []) {
    if (/^select 1 from public\.admins/.test(sql)) return { rows: state.admins.includes(p[0]) ? [{}] : [] };
    if (/^select p\.id, u\.email, u\.created_at, u\.last_sign_in_at, pp\.slug/.test(sql)) return { rows: [{ id: T1, email: 'asha@example.com', created_at: '2026-11-01', last_sign_in_at: null, slug: 'asha-rao-33333b', updated_at: '2026-11-14', data: blob }] };
    if (/^select u\.email, u\.created_at/.test(sql)) return { rows: p[0] === T1 ? [{ email: 'asha@example.com', created_at: '2026-11-01', last_sign_in_at: null, slug: 'asha-rao-33333b', updated_at: '2026-11-14', data: blob }] : [] };
    if (/^insert into public\.admin_audit/.test(sql)) { state.audit.push({ admin: p[0], therapist: p[1], action: p[2] }); return { rows: [] }; }
    if (/from public\.booking_inbox/.test(sql)) return { rows: [{ kind: 'booking', n: 3, pending: 1 }] };
    if (/from public\.admin_audit a/.test(sql)) return { rows: state.audit.map((a) => ({ at: '2026-11-14', action: a.action, admin_email: 'me@example.com', therapist_email: 'asha@example.com' })) };
    return { rows: [] };
  }, release() {},
};
require.cache[path.resolve(__dirname, '../api/_lib/db.js')] = { id: 'db', filename: 'db', loaded: true, exports: { getPool: () => ({ connect: async () => client }) } };
global.fetch = async (url, o) => { const tok = ((o.headers || {}).Authorization || '').replace('Bearer ', ''); const u = state.tokens[tok]; return u ? { ok: true, json: async () => u } : { ok: false, json: async () => ({}) }; };
const admin = require('../api/admin.js');
const res = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } });
const call = async (query, token) => { const r = res(); await admin({ method: 'GET', query, headers: token ? { authorization: 'Bearer ' + token } : {} }, r); return r; };

test('no token, a wrong token, or a signed-in person who is not an admin gets nothing', async () => {
  assert.strictEqual((await call({ action: 'list' })).statusCode, 401);
  assert.strictEqual((await call({ action: 'list' }, 'nope-nope-nope-nope-nope')).statusCode, 401);
  const r = await call({ action: 'list' }, 'other-token-bbbbbbbbbbbbbbbbb'); assert.strictEqual(r.statusCode, 403); assert.ok(!r.body.therapists);
  assert.strictEqual((await call({ action: 'view', id: T1 }, 'other-token-bbbbbbbbbbbbbbbbb')).statusCode, 403);
  assert.strictEqual(state.audit.length, 0, 'a refused request records nothing as an opening');
});
test('an admin sees every therapist with a summary, and the list carries no client data', async () => {
  const r = await call({ action: 'list' }, 'admin-token-aaaaaaaaaaaaaaaa');
  assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.headers['Cache-Control'], 'no-store'); assert.match(r.headers['X-Robots-Tag'], /noindex/);
  const t = r.body.therapists[0]; assert.strictEqual(t.email, 'asha@example.com'); assert.strictEqual(t.name, 'Asha Rao');
  assert.deepStrictEqual([t.clients, t.sessions, t.upcoming, t.held, t.waitlist], [2, 2, 1, 1, 1], 'placeholder rows are not counted');
  assert.ok(!JSON.stringify(r.body).includes('r@example.com'), 'the list holds no client details');
});
test('opening a therapist returns the full data and is recorded', async () => {
  const r = await call({ action: 'view', id: T1 }, 'admin-token-aaaaaaaaaaaaaaaa');
  assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.data.clients[0].email, 'r@example.com'); assert.deepStrictEqual(r.body.inbox, [{ kind: 'booking', n: 3, pending: 1 }]);
  assert.deepStrictEqual(state.audit, [{ admin: ADMIN, therapist: T1, action: 'view' }]);
  const a = await call({ action: 'audit' }, 'admin-token-aaaaaaaaaaaaaaaa'); assert.strictEqual(a.body.entries.length, 1); assert.strictEqual(a.body.entries[0].therapist, 'asha@example.com');
});
test('bad ids and unknown actions are refused, and other methods are not allowed', async () => {
  assert.strictEqual((await call({ action: 'view', id: 'not-a-uuid' }, 'admin-token-aaaaaaaaaaaaaaaa')).statusCode, 400);
  assert.strictEqual((await call({ action: 'view', id: '44444444-4444-4444-8444-444444444444' }, 'admin-token-aaaaaaaaaaaaaaaa')).statusCode, 404);
  assert.strictEqual((await call({ action: 'wipe' }, 'admin-token-aaaaaaaaaaaaaaaa')).statusCode, 400);
  const r = res(); await admin({ method: 'POST', query: {}, headers: {} }, r); assert.strictEqual(r.statusCode, 405);
  assert.strictEqual(state.audit.length, 1, 'only the one real opening was recorded');
});
