// Sends the "your session starts in about 30 minutes" email, once per booking.
// Something calls this every minute (see supabase/migrations/0007_reminder_schedule.sql). It is safe to call at any time:
// it only picks bookings that start within the next 35 minutes and have not been reminded, and it marks each one before sending.
// Sessions the therapist added in the console count the same as ones clients booked: just before the reminder, each one gets a private record in the
// booking inbox (already marked as imported, so the console ignores it) so the Yes and Reschedule links have something to open.
// If CRON_SECRET is set, the caller must send it as "Authorization: Bearer <secret>".
const crypto = require('crypto');
const { getPool } = require('./_lib/db');
const { sha, siteUrl, therapistLabel } = require('./_lib/slots');
const { reminderEmail, sendMail } = require('./_lib/mail');

const LEAD_MIN = 35;          // look this far ahead
const MIN_NOTICE_MIN = 30;    // a booking made less than this long before the start already got its confirmation, so it gets no reminder

const CLIENT_BOOKED = /^b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Sessions made in the console live only in the console's own data. For those about to start, make the private record the reminder links need.
async function recordConsoleSessions(client) {
  const now = Date.now(), hi = now + LEAD_MIN * 60000;
  const r = await client.query(
    `select d.practitioner_id, p.slug, d.data
       from public.practice_data d join public.practice_public p on p.practitioner_id = d.practitioner_id
      where jsonb_path_exists(d.data, '$.appts[*] ? (@.status == "upcoming" && @.start > $lo && @.start <= $hi)', jsonb_build_object('lo', $1::numeric, 'hi', $2::numeric))`, [now, hi]);
  let made = 0;
  for (const row of r.rows) {
    for (const a of ((row.data || {}).appts || [])) {
      if (!a || a.status !== 'upcoming' || typeof a.id !== 'string' || CLIENT_BOOKED.test(a.id)) continue;
      const start = Number(a.start), dur = Number(a.dur) || 50;
      if (!(start > now && start <= hi) || !/^\S+@\S+\.\S+$/.test(String(a.email || ''))) continue;
      const made1 = /^a(\d{12,13})/.exec(a.id);
      const createdAt = made1 && Number(made1[1]) <= now ? new Date(Number(made1[1])).toISOString() : new Date(now).toISOString();
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1::text))', [a.id]);
        const have = await client.query("select id from public.booking_inbox where practitioner_id = $1 and kind = 'booking' and summary->>'apptId' = $2 and starts_at = $3", [row.practitioner_id, a.id, new Date(start).toISOString()]);
        if (!have.rows.length) {
          const summary = { name: String(a.name || '').trim().split(/\s+/)[0].slice(0, 60), email: String(a.email).trim().toLowerCase().slice(0, 120), type: a.type, dur, fee: Number(a.fee) || 0, mode: a.mode || 'Online', apptId: a.id };
          await client.query("insert into public.booking_inbox (practitioner_id, kind, starts_at, ends_at, payload, summary, imported_at, created_at) values ($1, 'booking', $2, $3, '{}', $4, now(), $5)",
            [row.practitioner_id, new Date(start).toISOString(), new Date(start + dur * 60000).toISOString(), JSON.stringify(summary), createdAt]);
          made++;
        }
        await client.query('commit');
      } catch (e) { try { await client.query('rollback'); } catch (_) {} console.error('record console session failed', e.code || e.name); }
    }
  }
  return made;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false });
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization || '') !== 'Bearer ' + secret) return res.status(401).json({ ok: false });
  const base = siteUrl();
  if (!base) return res.status(200).json({ ok: true, due: 0, sent: 0, note: 'no site address configured' });

  let client, due = 0, sent = 0, skipped = 0;
  try {
    client = await getPool().connect();
    try { await recordConsoleSessions(client); } catch (e) { console.error('console sessions step failed', e.code || e.name); }
    const r = await client.query(
      `select b.id, b.practitioner_id, b.starts_at, b.created_at, b.summary, p.slug, p.data
         from public.booking_inbox b join public.practice_public p on p.practitioner_id = b.practitioner_id
        where b.kind = 'booking' and b.cancelled_at is null and b.remind_sent_at is null
          and b.starts_at > now() and b.starts_at <= now() + ($1 || ' minutes')::interval
        order by b.starts_at limit 25`, [String(LEAD_MIN)]);
    due = r.rows.length;
    for (const row of r.rows) {
      const sum = row.summary || {}, data = row.data || {}, start = new Date(row.starts_at).getTime();
      const skip = async () => { await client.query('update public.booking_inbox set remind_sent_at = now() where id = $1 and remind_sent_at is null', [row.id]); skipped++; };
      if (!/^\S+@\S+\.\S+$/.test(sum.email || '') || (data.settings || {}).remind30 === false || new Date(row.created_at).getTime() > start - MIN_NOTICE_MIN * 60000) { await skip(); continue; }
      // The therapist may have cancelled or moved it in the console since: the console's copy is then newer than this row.
      const cp = await client.query('select data from public.practice_data where practitioner_id = $1', [row.practitioner_id]);
      const appt = cp.rows.length && ((cp.rows[0].data || {}).appts || []).find((a) => a && a.id === (sum.apptId || 'b' + row.id));
      if (appt && (appt.status !== 'upcoming' || Math.abs(Number(appt.start) - start) > 60000)) { await skip(); continue; }

      // Claim it first, so two overlapping runs cannot both send. The reminder gets its own private key.
      const key = crypto.randomBytes(24).toString('base64url');
      const claim = await client.query('update public.booking_inbox set remind_sent_at = now(), remind_hash = $2 where id = $1 and remind_sent_at is null and cancelled_at is null returning id', [row.id, sha(key)]);
      if (!claim.rows.length) continue;
      let result = 'failed';
      try {
        const t = await client.query('select email from auth.users where id = $1', [row.practitioner_id]);
        const therapistAddr = t.rows.length ? t.rows[0].email : '';
        const link = `${base}/?t=${row.slug}&b=${row.id}&k=${key}`;
        const settings = data.settings || {};
        const ty = (data.types || []).find((x) => x.id === sum.type) || { name: 'Session', min: sum.dur };
        const mail = reminderEmail({ clientName: sum.name || 'there', therapistName: therapistLabel(data.profile), typeName: ty.name, min: Number(sum.dur) || ty.min, start, tzOff: data.tzOff,
          mode: sum.mode, where: (data.profile || {}).where, room: settings.videoMode === 'Same link for everyone' || !settings.videoMode ? settings.room : '', yesUrl: link + '&a=yes', changeUrl: link + '&a=no' });
        result = await sendMail(Object.assign({ to: sum.email, replyTo: therapistAddr }, mail));
      } catch (e) { console.error('reminder mail step failed', e.code || e.name); }
      if (result === 'sent') sent++;
      else await client.query('update public.booking_inbox set remind_sent_at = null, remind_hash = null where id = $1', [row.id]); // try again on the next run
    }
    return res.status(200).json({ ok: true, due, sent, skipped });
  } catch (e) {
    console.error('remind failed', e.code || e.name);
    return res.status(503).json({ ok: false });
  } finally {
    if (client) client.release();
  }
};
