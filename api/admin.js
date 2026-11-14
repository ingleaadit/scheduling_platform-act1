// Platform admin, read only. The caller sends their Supabase sign-in token; it is checked with Supabase, then the person must be listed in public.admins.
//   GET /api/admin?action=list            every therapist account with a short summary
//   GET /api/admin?action=view&id=<uuid>  one therapist's full console data (this is recorded in public.admin_audit)
//   GET /api/admin?action=audit           who opened which account, newest first
const { getPool } = require('./_lib/db');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SB_URL = () => process.env.SUPABASE_URL || 'https://bpkisvfrhjesumnavvet.supabase.co';
const SB_KEY = () => process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_t6IulDmRu24ew0HgCyfu4w_bWcNb7K4'; // public, the same key the browser uses

async function signedInUser(req) {
  const m = /^Bearer (\S{20,4000})$/.exec(String((req.headers || {}).authorization || ''));
  if (!m) return null;
  const r = await fetch(SB_URL() + '/auth/v1/user', { headers: { apikey: SB_KEY(), Authorization: 'Bearer ' + m[1] } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && UUID.test(u.id || '') ? { id: u.id, email: u.email || '' } : null;
}

// A short summary of a console's data, for the list.
function summarise(d) {
  d = d || {};
  const appts = (Array.isArray(d.appts) ? d.appts : []).filter((a) => a && !/^x\d+$/.test(a.id || '')), names = new Set();
  (d.clients || []).forEach((c) => c && c.name && names.add(c.name));
  appts.forEach((a) => a.name && names.add(a.name));
  const count = (st) => appts.filter((a) => a.status === st).length;
  return { name: (d.profile || {}).name || '', plan: (d.settings || {}).plan || '', clients: names.size, sessions: appts.length, upcoming: count('upcoming'), held: count('held'), cancelled: count('cancelled'), waitlist: (d.waitlist || []).length };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const q = req.query || {}, action = String(q.action || 'list');
  let client;
  try {
    const user = await signedInUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'signin' });
    client = await getPool().connect();
    const adm = await client.query('select 1 from public.admins where user_id = $1', [user.id]);
    if (!adm.rows.length) return res.status(403).json({ ok: false, error: 'not_admin' });

    if (action === 'list') {
      const r = await client.query(
        `select p.id, u.email, u.created_at, u.last_sign_in_at, pp.slug, pd.updated_at, pd.data
           from public.practitioners p join auth.users u on u.id = p.id
           left join public.practice_data pd on pd.practitioner_id = p.id
           left join public.practice_public pp on pp.practitioner_id = p.id
          order by u.created_at desc limit 200`);
      return res.status(200).json({ ok: true, me: user.email, therapists: r.rows.map((x) => Object.assign({ id: x.id, email: x.email, createdAt: x.created_at, lastSignIn: x.last_sign_in_at, slug: x.slug || '', savedAt: x.updated_at }, summarise(x.data))) });
    }
    if (action === 'view') {
      const id = String(q.id || '');
      if (!UUID.test(id)) return res.status(400).json({ ok: false });
      const r = await client.query(
        `select u.email, u.created_at, u.last_sign_in_at, pp.slug, pd.updated_at, pd.data
           from public.practitioners p join auth.users u on u.id = p.id
           left join public.practice_data pd on pd.practitioner_id = p.id
           left join public.practice_public pp on pp.practitioner_id = p.id
          where p.id = $1`, [id]);
      if (!r.rows.length) return res.status(404).json({ ok: false });
      await client.query('insert into public.admin_audit (admin_id, practitioner_id, action) values ($1, $2, $3)', [user.id, id, 'view']);
      const inbox = await client.query('select kind, count(*)::int as n, (count(*) filter (where imported_at is null))::int as pending from public.booking_inbox where practitioner_id = $1 group by kind', [id]);
      const x = r.rows[0];
      return res.status(200).json({ ok: true, therapist: { id, email: x.email, createdAt: x.created_at, lastSignIn: x.last_sign_in_at, slug: x.slug || '', savedAt: x.updated_at }, data: x.data || {}, inbox: inbox.rows });
    }
    if (action === 'audit') {
      const r = await client.query(
        `select a.at, a.action, au.email as admin_email, pu.email as therapist_email
           from public.admin_audit a join auth.users au on au.id = a.admin_id left join auth.users pu on pu.id = a.practitioner_id
          order by a.at desc limit 50`);
      return res.status(200).json({ ok: true, entries: r.rows.map((x) => ({ at: x.at, action: x.action, admin: x.admin_email, therapist: x.therapist_email || '' })) });
    }
    return res.status(400).json({ ok: false });
  } catch (e) {
    console.error('admin failed', e.code || e.name);
    return res.status(503).json({ ok: false });
  } finally {
    if (client) client.release();
  }
};
