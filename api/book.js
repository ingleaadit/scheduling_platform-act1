// Public: takes a booking or a waitlist request from the booking page and stores it for the therapist.
// Everything is checked again here; nothing the browser sends is trusted (fee and length come from the therapist's own settings).
const crypto = require('crypto');
const { getPool } = require('./_lib/db');
const { confirmationEmail, therapistEmail, sendMail } = require('./_lib/mail');

const { DAY, str, sha, slotAllowed, ipHash, overLimit, siteUrl } = require('./_lib/slots');

function buildBooking(data, body) {
  const fn = str(body.fn, 60), ln = str(body.ln, 60), email = str(body.email, 120), wa = str(body.wa, 20).replace(/\D/g, '');
  if (!fn || !ln || !/^\S+@\S+\.\S+$/.test(email) || wa.length !== 10) return { error: 'details' };
  if (body.agree !== true) return { error: 'agree' };
  const ty = (data.types || []).find((t) => t.id === body.type);
  const start = Number(body.start);
  if (!ty || !Number.isFinite(start)) return { error: 'details' };
  if (start < Date.now() || start > Date.now() + 60 * DAY || !slotAllowed(data, start, ty.min)) return { error: 'slot' };
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const intake = (data.intake || []).map((q) => ({ label: q.label, answer: str(answers[q.id], 2000), private: !!q.private })).filter((q) => q.answer);
  const g = body.guardian && typeof body.guardian === 'object' ? { name: str(body.guardian.name, 80), rel: str(body.guardian.rel, 40), wa: str(body.guardian.wa, 20) } : null;
  const id = crypto.randomUUID();
  const now = Date.now();
  return {
    id, start, end: start + ty.min * 60000, ty,
    appt: { id: 'b' + id, name: fn + ' ' + ln, wa: '+91 ' + wa, email, type: ty.id, start, dur: ty.min, fee: ty.fee, status: 'upcoming', paid: false, lateFee: 0, late: false, reason: '', waived: false,
      intake, guardian: g && g.name ? g : null, consentAt: now, bookedAt: now, mode: body.mode === 'In person' ? 'In person' : 'Online', source: 'Client page', reminded: false, isNew: true },
  };
}

function buildWaitlist(data, body) {
  const fn = str(body.fn, 60), ln = str(body.ln, 60), wa = str(body.wa, 20).replace(/\D/g, '');
  if (!fn || !ln || wa.length !== 10) return { error: 'details' };
  const ty = (data.types || []).find((t) => t.id === body.type) || (data.types || [])[0];
  const id = crypto.randomUUID();
  return { id, entry: { id: 'w' + id, name: fn + ' ' + ln, wa: '+91 ' + wa, days: str(body.days, 40) || 'Any day', times: str(body.times, 40) || 'Any time', type: ty ? ty.id : 'first', joined: Date.now(), source: 'Client page', offered: null } };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const body = req.body && typeof req.body === 'object' ? req.body : null;
  if (!body || JSON.stringify(body).length > 30000) return res.status(400).json({ ok: false, error: 'details' });
  const slug = str(body.t, 60).toLowerCase();
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return res.status(404).json({ ok: false });
  // A hidden field that people never see or fill. Scripts that fill every field give themselves away; they get a plain "ok" and nothing is stored.
  if (str(body.hp, 200)) return res.status(200).json({ ok: true });

  let client;
  try {
    client = await getPool().connect();
    const p = await client.query('select practitioner_id, data from public.practice_public where slug = $1', [slug]);
    if (!p.rows.length) return res.status(404).json({ ok: false });
    const pid = p.rows[0].practitioner_id, data = p.rows[0].data || {};
    const ip = ipHash(req, pid);

    if (body.kind === 'waitlist') {
      const w = buildWaitlist(data, body);
      if (w.error) return res.status(400).json({ ok: false, error: w.error });
      if (await overLimit(client, pid, ip, '')) return res.status(429).json({ ok: false, error: 'limit' });
      await client.query("insert into public.booking_inbox (id, practitioner_id, kind, payload, ip_hash) values ($1, $2, 'waitlist', $3, $4)", [w.id, pid, JSON.stringify(w.entry), ip]);
      return res.status(200).json({ ok: true });
    }

    const b = buildBooking(data, body);
    if (b.error) return res.status(b.error === 'slot' ? 409 : 400).json({ ok: false, error: b.error });

    // One booking at a time per therapist, so two people cannot take the same slot.
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1::text))', [pid]);
    const taken = (data.busy || []).some(([s, e]) => b.start < e && b.end > s);
    const pending = await client.query(
      "select 1 from public.booking_inbox where practitioner_id = $1 and kind in ('booking', 'reschedule') and imported_at is null and cancelled_at is null and starts_at < $3 and ends_at > $2 limit 1",
      [pid, new Date(b.start).toISOString(), new Date(b.end).toISOString()]);
    if (taken || pending.rows.length) { await client.query('rollback'); return res.status(409).json({ ok: false, error: 'slot' }); }
    if (await overLimit(client, pid, ip, b.appt.email.toLowerCase())) { await client.query('rollback'); return res.status(429).json({ ok: false, error: 'limit' }); }
    // The private key that lets this client change the booking later. Only its hash is stored.
    const key = crypto.randomBytes(24).toString('base64url');
    const summary = { name: b.appt.name.split(/\s+/)[0], email: b.appt.email.toLowerCase(), type: b.ty.id, dur: b.ty.min, fee: b.ty.fee, mode: b.appt.mode };
    await client.query("insert into public.booking_inbox (id, practitioner_id, kind, starts_at, ends_at, payload, summary, token_hash, ip_hash) values ($1, $2, 'booking', $3, $4, $5, $6, $7, $8)",
      [b.id, pid, new Date(b.start).toISOString(), new Date(b.end).toISOString(), JSON.stringify(b.appt), JSON.stringify(summary), sha(key), ip]);
    await client.query('commit');

    // Emails. A failure here never undoes the booking.
    let mail = 'skipped';
    try {
      const t = await client.query('select email from auth.users where id = $1', [pid]);
      const therapistAddr = t.rows.length ? t.rows[0].email : '';
      const s = data.settings || {}, prof = data.profile || {};
      const info = { clientName: b.appt.name, therapistName: prof.name || 'your therapist', typeName: b.ty.name, min: b.ty.min, start: b.start, tzOff: data.tzOff, mode: b.appt.mode,
        where: String(prof.where || '').replace(/^Online, and in person in /, ''), room: s.room, fee: b.ty.fee, cancelWindow: s.cancelWindow, latePct: s.latePct,
        manageUrl: siteUrl() ? `${siteUrl()}/?t=${slug}&b=${b.id}&k=${key}` : '' };
      mail = await sendMail(Object.assign({ to: b.appt.email, replyTo: therapistAddr }, confirmationEmail(info)));
      await sendMail(Object.assign({ to: therapistAddr }, therapistEmail(info)));
    } catch (e) { console.error('book mail step failed', e.code || e.name); mail = 'failed'; }

    return res.status(200).json({ ok: true, appt: b.appt, room: (data.settings || {}).room || '', mail, manage: { b: b.id, k: key } });
  } catch (e) {
    try { if (client) await client.query('rollback'); } catch (_) {}
    console.error('book failed', e.code || e.name);
    return res.status(503).json({ ok: false });
  } finally {
    if (client) client.release();
  }
};
