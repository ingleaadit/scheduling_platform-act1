// An in-memory stand-in for the database, shaped to the queries the public booking functions send.
const crypto = require('crypto');
function makeFakeDb(slug, pid) {
  const db = { pub: null, inbox: [], fail: false, limit: null, practiceData: null, now: null };
  const live = (r) => !r.imported_at && !r.cancelled_at;
  const client = {
    async query(sql, p = []) {
      if (db.fail) { const e = new Error('down'); e.code = 'ECONNREFUSED'; throw e; }
      if (/^select practitioner_id, data from public\.practice_public/.test(sql) || /^select data from public\.practice_public/.test(sql))
        return { rows: db.pub && p[0] === slug ? [{ practitioner_id: pid, data: JSON.parse(JSON.stringify(db.pub)) }] : [] };
      if (/select starts_at, ends_at from public\.booking_inbox/.test(sql))
        return { rows: db.inbox.filter((r) => ['booking', 'reschedule'].includes(r.kind) && live(r)).map((r) => ({ starts_at: r.starts_at, ends_at: r.ends_at })) };
      if (/count\(\*\) filter/.test(sql)) {
        if (db.limit) return { rows: [db.limit] };
        return { rows: [{ hour_all: db.inbox.length, hour_ip: db.inbox.filter((r) => p[1] && r.ip_hash === p[1] && (r.kind === 'booking' || r.kind === 'waitlist')).length, day_email: db.inbox.filter((r) => r.kind === 'booking' && !r.cancelled_at && p[2] && (r.summary || {}).email === p[2]).length }] };
      }
      if (/^select d\.practitioner_id, p\.slug, d\.data/.test(sql)) return { rows: db.practiceData && db.pub ? [{ practitioner_id: pid, slug, data: JSON.parse(JSON.stringify(db.practiceData)) }] : [] };
      if (/^select id from public\.booking_inbox where practitioner_id = \$1 and kind = 'booking' and summary->>'apptId'/.test(sql))
        return { rows: db.inbox.filter((r) => r.kind === 'booking' && (r.summary || {}).apptId === p[1] && new Date(r.starts_at).getTime() === new Date(p[2]).getTime()).map((r) => ({ id: r.id })) };
      if (/^insert into public\.booking_inbox \(practitioner_id, kind, starts_at, ends_at, payload, summary, imported_at, created_at\)/.test(sql)) {
        db.inbox.push({ id: crypto.randomUUID(), kind: 'booking', starts_at: p[1], ends_at: p[2], payload: {}, summary: JSON.parse(p[3]), imported_at: new Date().toISOString(), cancelled_at: null, created_at: p[4] }); return { rows: [] };
      }
      if (/^select 1 from public\.booking_inbox/.test(sql))
        return { rows: db.inbox.filter((r) => ['booking', 'reschedule'].includes(r.kind) && live(r) && r.starts_at < p[2] && r.ends_at > p[1] && (!p[3] || (r.id !== p[3] && r.booking_id !== p[3]))).map(() => ({})) };
      if (/^insert into public\.booking_inbox/.test(sql)) {
        const base = { imported_at: null, cancelled_at: null, created_at: new Date().toISOString() };
        if (/'waitlist'/.test(sql)) db.inbox.push(Object.assign(base, { id: p[0], kind: 'waitlist', payload: JSON.parse(p[2]), ip_hash: p[3] }));
        else if (/'booking'/.test(sql)) db.inbox.push(Object.assign(base, { id: p[0], kind: 'booking', starts_at: p[2], ends_at: p[3], payload: JSON.parse(p[4]), summary: JSON.parse(p[5]), token_hash: p[6], ip_hash: p[7] }));
        else if (/'attend'/.test(sql)) db.inbox.push(Object.assign(base, { id: crypto.randomUUID(), kind: 'attend', booking_id: p[1], payload: JSON.parse(p[2]), ip_hash: p[3] }));
        else if (/'payment'/.test(sql)) db.inbox.push(Object.assign(base, { id: crypto.randomUUID(), kind: 'payment', booking_id: p[1], payload: JSON.parse(p[2]), ip_hash: p[3] }));
        else if (/'cancel'/.test(sql)) db.inbox.push(Object.assign(base, { id: crypto.randomUUID(), kind: 'cancel', booking_id: p[1], payload: JSON.parse(p[2]), ip_hash: p[3] }));
        else db.inbox.push(Object.assign(base, { id: crypto.randomUUID(), kind: 'reschedule', booking_id: p[1], starts_at: p[2], ends_at: p[3], payload: JSON.parse(p[4]), ip_hash: p[5] }));
        return { rows: [] };
      }
      if (/^select b\.id, b\.practitioner_id, b\.starts_at, b\.created_at/.test(sql)) {
        const now = db.now || Date.now(), lim = now + Number(p[0]) * 60000;
        return { rows: db.inbox.filter((r) => r.kind === 'booking' && !r.cancelled_at && !r.remind_sent_at && new Date(r.starts_at).getTime() > now && new Date(r.starts_at).getTime() <= lim)
          .map((r) => ({ id: r.id, practitioner_id: pid, starts_at: r.starts_at, created_at: r.created_at, summary: JSON.parse(JSON.stringify(r.summary)), slug, data: JSON.parse(JSON.stringify(db.pub)) })) };
      }
      if (/^select b\.id, b\.practitioner_id/.test(sql)) {
        const r = db.inbox.find((x) => x.id === p[1] && x.kind === 'booking');
        return { rows: r && db.pub && p[0] === slug ? [{ id: r.id, practitioner_id: pid, starts_at: r.starts_at, ends_at: r.ends_at, summary: JSON.parse(JSON.stringify(r.summary)), token_hash: r.token_hash, remind_hash: r.remind_hash || null, cancelled_at: r.cancelled_at, data: JSON.parse(JSON.stringify(db.pub)) }] : [] };
      }
      if (/set cancelled_at = now\(\), summary = summary/.test(sql)) { const r = db.inbox.find((x) => x.id === p[0]); r.cancelled_at = new Date().toISOString(); Object.assign(r.summary, JSON.parse(p[1])); return { rows: [] }; }
      if (/^update public\.booking_inbox set summary = summary \|\| \$2::jsonb where id = \$1/.test(sql)) { const r = db.inbox.find((x) => x.id === p[0]); Object.assign(r.summary, JSON.parse(p[1])); return { rows: [] }; }
      if (/set starts_at = \$2, ends_at = \$3/.test(sql)) { const r = db.inbox.find((x) => x.id === p[0]); r.starts_at = p[1]; r.ends_at = p[2]; return { rows: [] }; }
      if (/set cancelled_at = now\(\) where booking_id/.test(sql)) { db.inbox.forEach((x) => { if (x.booking_id === p[0] && x.kind === 'reschedule' && !x.imported_at) x.cancelled_at = new Date().toISOString(); }); return { rows: [] }; }
      if (/^select data from public\.practice_data/.test(sql)) return { rows: db.practiceData ? [{ data: db.practiceData }] : [] };
      if (/set remind_sent_at = now\(\), remind_hash = \$2/.test(sql)) { const r = db.inbox.find((x) => x.id === p[0] && !x.remind_sent_at && !x.cancelled_at); if (!r) return { rows: [] }; r.remind_sent_at = new Date().toISOString(); r.remind_hash = p[1]; return { rows: [{ id: r.id }] }; }
      if (/set remind_sent_at = now\(\) where id = \$1/.test(sql)) { const r = db.inbox.find((x) => x.id === p[0] && !x.remind_sent_at); if (r) r.remind_sent_at = new Date().toISOString(); return { rows: [] }; }
      if (/set remind_sent_at = null, remind_hash = null/.test(sql)) { const r = db.inbox.find((x) => x.id === p[0]); r.remind_sent_at = null; r.remind_hash = null; return { rows: [] }; }
      if (/from auth\.users/.test(sql)) return { rows: [{ email: 'therapist@example.com' }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { connect: async () => client, query: (s, p) => client.query(s, p) };
  return { db, pool };
}
module.exports = { makeFakeDb };
