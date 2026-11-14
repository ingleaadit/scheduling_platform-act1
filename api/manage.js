// Public: lets a client see, cancel or move their own booking, using the private link they were given when they booked.
// The change is stored for the therapist's console to apply; the console stays the one place that owns the practice data.
const crypto = require('crypto');
const { getPool } = require('./_lib/db');
const { str, sha, slotAllowed, ipHash, overLimit, siteUrl, therapistLabel } = require('./_lib/slots');
const { changeEmail, paymentEmail, attendEmail, sendMail } = require('./_lib/mail');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REASONS = ['Unwell', 'Work or travel', 'Clinical reason', 'Forgot', 'Other'];
function sameHash(a, b) { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); }

// Finds the booking only when the slug, id and private key all match. A wrong key looks the same as a missing booking.
async function find(client, slug, id, key) {
  if (!/^[a-z0-9-]{3,60}$/.test(slug) || !UUID.test(id) || !key || key.length > 80) return null;
  const r = await client.query(
    "select b.id, b.practitioner_id, b.starts_at, b.ends_at, b.summary, b.token_hash, b.remind_hash, b.cancelled_at, p.data from public.booking_inbox b join public.practice_public p on p.practitioner_id = b.practitioner_id where p.slug = $1 and b.id = $2 and b.kind = 'booking'", [slug, id]);
  // The booking-confirmation key or the key sent in the reminder email both open the booking.
  if (!r.rows.length || !(sameHash(r.rows[0].token_hash, sha(key)) || (r.rows[0].remind_hash && sameHash(r.rows[0].remind_hash, sha(key))))) return null;
  return r.rows[0];
}
function view(row) {
  const s = row.summary || {}, start = new Date(row.starts_at).getTime();
  return { id: 'b' + row.id, name: s.name || '', email: s.email || '', type: s.type, start, dur: s.dur, fee: s.fee, mode: s.mode || 'Online',
    status: row.cancelled_at ? 'cancelled' : 'upcoming', claimed: !!(s.pay), attend: (s.attend && s.attend.answer) || '', late: !!(s.cancel && s.cancel.late), lateFee: (s.cancel && s.cancel.lateFee) || 0, reason: (s.cancel && s.cancel.reason) || '' };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const src = req.method === 'GET' ? (req.query || {}) : req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body : null;
  if (!src) return res.status(req.method === 'GET' || req.method === 'POST' ? 400 : 405).json({ ok: false });
  const slug = str(src.t, 60).toLowerCase(), id = str(src.b, 40).toLowerCase(), key = str(src.k, 100);

  let client;
  try {
    client = await getPool().connect();
    const row = await find(client, slug, id, key);
    if (!row) return res.status(404).json({ ok: false });
    if (req.method === 'GET') return res.status(200).json({ ok: true, booking: view(row) });

    const data = row.data || {}, s = data.settings || {}, sum = row.summary || {}, pid = row.practitioner_id;
    const oldStart = new Date(row.starts_at).getTime(), now = Date.now();
    if (row.cancelled_at) return res.status(409).json({ ok: false, error: 'cancelled' });
    if (oldStart <= now) return res.status(409).json({ ok: false, error: 'past' });
    const late = oldStart - now < (Number(s.cancelWindow) || 0) * 36e5;
    const ty = (data.types || []).find((t) => t.id === sum.type) || { id: sum.type, name: 'Session', min: sum.dur, fee: sum.fee };
    const apptId = 'b' + row.id;
    let mailInfo;

    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1::text))', [pid]);
    if (await overLimit(client, pid, ipHash(req, pid), '')) { await client.query('rollback'); return res.status(429).json({ ok: false, error: 'limit' }); }

    if (src.action === 'cancel') {
      const reason = REASONS.includes(src.reason) ? src.reason : 'Other';
      const lateFee = late ? Math.round((Number(sum.fee) || 0) * (Number(s.latePct) || 0) / 100) : 0;
      await client.query("update public.booking_inbox set cancelled_at = now(), summary = summary || $2::jsonb where id = $1", [row.id, JSON.stringify({ cancel: { late, lateFee, reason } })]);
      await client.query("insert into public.booking_inbox (practitioner_id, kind, booking_id, payload, ip_hash) values ($1, 'cancel', $2, $3, $4)",
        [pid, row.id, JSON.stringify({ id: 'c' + crypto.randomUUID(), apptId, reason, at: now }), ipHash(req, pid)]);
      await client.query('commit');
      row.cancelled_at = new Date(); row.summary = Object.assign({}, sum, { cancel: { late, lateFee, reason } });
      mailInfo = { kind: 'cancelled', start: oldStart, lateFee };
    } else if (src.action === 'paid') {
      // The client says they paid by UPI. This only tells the therapist; the therapist records the payment after checking their bank.
      const utr = str(src.utr, 20).replace(/\s/g, '');
      if (utr && !/^\d{12}$/.test(utr)) { await client.query('rollback'); return res.status(400).json({ ok: false, error: 'utr' }); }
      await client.query("update public.booking_inbox set summary = summary || $2::jsonb where id = $1", [row.id, JSON.stringify({ pay: { utr, at: now } })]);
      await client.query("insert into public.booking_inbox (practitioner_id, kind, booking_id, payload, ip_hash) values ($1, 'payment', $2, $3, $4)",
        [pid, row.id, JSON.stringify({ id: 'p' + crypto.randomUUID(), apptId, utr, at: now }), ipHash(req, pid)]);
      await client.query('commit');
      row.summary = Object.assign({}, sum, { pay: { utr, at: now } });
      mailInfo = { kind: 'paid', start: oldStart, utr, fee: sum.fee };
    } else if (src.action === 'attend') {
      // The client's answer to the reminder email. It changes nothing about the session; it only tells the therapist.
      const answer = src.answer === 'no' ? 'no' : 'yes';
      await client.query("update public.booking_inbox set summary = summary || $2::jsonb where id = $1", [row.id, JSON.stringify({ attend: { answer, at: now } })]);
      await client.query("insert into public.booking_inbox (practitioner_id, kind, booking_id, payload, ip_hash) values ($1, 'attend', $2, $3, $4)",
        [pid, row.id, JSON.stringify({ id: 't' + crypto.randomUUID(), apptId, answer, at: now }), ipHash(req, pid)]);
      await client.query('commit');
      row.summary = Object.assign({}, sum, { attend: { answer, at: now } });
      mailInfo = { kind: 'attend', answer, start: oldStart };
    } else if (src.action === 'reschedule') {
      const start = Number(src.start), dur = Number(sum.dur) || ty.min, end = start + dur * 60000;
      if (late) { await client.query('rollback'); return res.status(409).json({ ok: false, error: 'late' }); }
      if (!Number.isFinite(start) || start < now || start > now + 60 * 864e5 || !slotAllowed(data, start, dur)) { await client.query('rollback'); return res.status(409).json({ ok: false, error: 'slot' }); }
      // Their own current time does not count as taken.
      const oldEnd = new Date(row.ends_at).getTime();
      const taken = (data.busy || []).some(([f, t]) => start < t && end > f && !(f === oldStart && t === oldEnd));
      const pending = await client.query(
        "select 1 from public.booking_inbox where practitioner_id = $1 and kind in ('booking', 'reschedule') and imported_at is null and cancelled_at is null and starts_at < $3 and ends_at > $2 and id <> $4 and booking_id is distinct from $4 limit 1",
        [pid, new Date(start).toISOString(), new Date(end).toISOString(), row.id]);
      if (taken || pending.rows.length) { await client.query('rollback'); return res.status(409).json({ ok: false, error: 'slot' }); }
      await client.query('update public.booking_inbox set starts_at = $2, ends_at = $3 where id = $1', [row.id, new Date(start).toISOString(), new Date(end).toISOString()]);
      // An earlier move that the console has not applied yet is replaced by this one.
      await client.query("update public.booking_inbox set cancelled_at = now() where booking_id = $1 and kind = 'reschedule' and imported_at is null", [row.id]);
      await client.query("insert into public.booking_inbox (practitioner_id, kind, booking_id, starts_at, ends_at, payload, ip_hash) values ($1, 'reschedule', $2, $3, $4, $5, $6)",
        [pid, row.id, new Date(start).toISOString(), new Date(end).toISOString(), JSON.stringify({ id: 'r' + crypto.randomUUID(), apptId, start, at: now }), ipHash(req, pid)]);
      await client.query('commit');
      row.starts_at = new Date(start);
      mailInfo = { kind: 'moved', start, oldStart };
    } else {
      await client.query('rollback');
      return res.status(400).json({ ok: false });
    }

    // Emails. A failure here never undoes the change.
    let mail = 'skipped';
    try {
      const t = await client.query('select email from auth.users where id = $1', [pid]);
      const therapistAddr = t.rows.length ? t.rows[0].email : '';
      const base = Object.assign({ clientName: sum.name || 'A client', therapistName: therapistLabel(data.profile), typeName: ty.name, min: Number(sum.dur) || ty.min, tzOff: data.tzOff,
        manageUrl: siteUrl() ? `${siteUrl()}/?t=${slug}&b=${row.id}&k=${key}` : '' }, mailInfo);
      if (mailInfo.kind === 'paid') {
        await sendMail(Object.assign({ to: therapistAddr }, paymentEmail(base)));
      } else if (mailInfo.kind === 'attend') {
        if (mailInfo.answer === 'no') await sendMail(Object.assign({ to: therapistAddr }, attendEmail(base)));
      } else {
        mail = await sendMail(Object.assign({ to: sum.email, replyTo: therapistAddr }, changeEmail(base)));
        await sendMail(Object.assign({ to: therapistAddr }, changeEmail(Object.assign({ forTherapist: true }, base))));
      }
    } catch (e) { console.error('manage mail step failed', e.code || e.name); mail = 'failed'; }

    return res.status(200).json({ ok: true, booking: view(row), mail });
  } catch (e) {
    try { if (client) await client.query('rollback'); } catch (_) {}
    console.error('manage failed', e.code || e.name);
    return res.status(503).json({ ok: false });
  } finally {
    if (client) client.release();
  }
};
