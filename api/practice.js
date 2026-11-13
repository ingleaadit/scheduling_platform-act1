// Public: what the booking page needs to show one therapist's page, looked up by the link's slug.
// The video room link is left out here; it is only sent to someone after they book.
const { getPool } = require('./_lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const slug = String((req.query && req.query.t) || '').toLowerCase();
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return res.status(404).json({ ok: false });
  try {
    const r = await getPool().query('select data from public.practice_public where slug = $1', [slug]);
    if (!r.rows.length) return res.status(404).json({ ok: false });
    const data = r.rows[0].data || {};
    if (data.settings) data.settings = Object.assign({}, data.settings, { room: '' });
    // Times held by bookings the therapist's console has not picked up yet.
    const p = await getPool().query(
      "select starts_at, ends_at from public.booking_inbox b join public.practice_public p on p.practitioner_id = b.practitioner_id where p.slug = $1 and b.kind in ('booking', 'reschedule') and b.imported_at is null and b.cancelled_at is null and b.ends_at > now()", [slug]);
    data.busy = (data.busy || []).concat(p.rows.map((x) => [new Date(x.starts_at).getTime(), new Date(x.ends_at).getTime()]));
    return res.status(200).json({ ok: true, data });
  } catch (e) {
    console.error('practice failed', e.code || e.name);
    return res.status(503).json({ ok: false });
  }
};
