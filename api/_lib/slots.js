// Shared checks for the public booking functions.
const crypto = require('crypto');
const DAY = 864e5;
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const mins = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

// Is the slot inside working hours and clear of blocked time? Uses the practice's own clock (tzOff, minutes from UTC as JavaScript reports it).
function slotAllowed(data, start, dur) {
  const off = (Number(data.tzOff) || 0) * 60000;
  const local = new Date(start - off);
  const wd = local.getUTCDay();
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  const inHours = ((data.hours || {})[wd] || []).some(([f, t]) => m >= mins(f) && m + dur <= mins(t));
  if (!inHours) return false;
  const day = Math.floor((start - off) / DAY);
  return !(data.blocks || []).some((b) => Math.floor((Number(b.date) - off) / DAY) === day && m < mins(b.to) && m + dur > mins(b.from));
}

// The visitor's address, hashed together with the therapist's id, so it can be counted but not read back.
function ipHash(req, pid) {
  const h = (req.headers || {});
  const ip = String(h['x-real-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim();
  return ip ? sha(ip + '|' + pid) : null;
}

// Simple limits so one visitor or a script cannot flood a therapist. Returns true when the request should be refused.
async function overLimit(client, pid, ip, email) {
  const r = await client.query(
    `select count(*) filter (where created_at > now() - interval '1 hour') as hour_all,
            count(*) filter (where created_at > now() - interval '1 hour' and ip_hash = $2) as hour_ip,
            count(*) filter (where created_at > now() - interval '1 day' and kind = 'booking' and summary->>'email' = $3) as day_email
       from public.booking_inbox where practitioner_id = $1 and created_at > now() - interval '1 day'`, [pid, ip, email || '']);
  const c = r.rows[0] || {};
  return Number(c.hour_all) >= 40 || (ip && Number(c.hour_ip) >= 6) || (email && Number(c.day_email) >= 3);
}

// The site's own address for links in emails. Never taken from the request, which a sender could forge.
function siteUrl() {
  const v = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : '');
  return v.replace(/\/+$/, '');
}

// "your therapist" until the therapist has entered a real name (the console's placeholder is "Your name").
function therapistLabel(profile) { const n = String((profile || {}).name || '').trim(); return !n || n === 'Your name' ? 'your therapist' : n; }

module.exports = { therapistLabel, DAY, str, mins, sha, slotAllowed, ipHash, overLimit, siteUrl };
