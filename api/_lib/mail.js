// Email templates and sending. Sending uses Resend (https://resend.com) when RESEND_API_KEY is set;
// without the key nothing is sent and the booking still goes through.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const money = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

// Times are stored as epoch milliseconds. tzOff is the practice's offset from UTC in minutes,
// as JavaScript reports it (India is -330), so the email shows the practice's local time.
function whenText(start, tzOff) {
  const d = new Date(Number(start) - (Number(tzOff) || 0) * 60000);
  const date = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).replace(/\s/g, ' ').toLowerCase();
  return date + ', ' + time;
}

function shell(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F1EC;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#0A0908">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<div style="background:#FFFFFF;border:1px solid #E2DCD3;border-radius:12px;padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${esc(title)}</h1>
${bodyHtml}
</div></div></body></html>`;
}

function rows(list) {
  return '<table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 20px">' + list.filter((r) => r[1]).map(([k, v]) =>
    `<tr><td style="padding:8px 12px 8px 0;border-top:1px solid #EEE9E1;color:#5E5850;font-size:14px;vertical-align:top;width:90px">${esc(k)}</td><td style="padding:8px 0;border-top:1px solid #EEE9E1;font-size:15px;vertical-align:top">${v}</td></tr>`).join('') + '</table>';
}

// b: { clientName, therapistName, typeName, min, start, tzOff, mode, where, room, fee, cancelWindow, latePct }
function confirmationEmail(b) {
  const when = whenText(b.start, b.tzOff);
  const online = b.mode !== 'In person';
  const link = online && b.room ? (/^https?:\/\//.test(b.room) ? b.room : 'https://' + b.room) : '';
  const whereText = online ? (link ? 'Online. Video link: ' + link : 'Online. ' + firstName(b.therapistName) + ' will send the video link before the session.') : 'In person' + (b.where ? ', ' + b.where : '');
  const whereHtml = online ? (link ? `Online. <a href="${esc(link)}" style="color:#0A0908">Join the video call</a>` : esc(whereText)) : esc(whereText);
  const policy = b.cancelWindow ? `You can cancel or move this session for free up to ${b.cancelWindow} hours before it starts.${b.latePct ? ` After that, ${b.latePct}% of the fee applies.` : ''}` : '';
  const subject = `Your session with ${b.therapistName} is booked: ${when}`;
  const html = shell(`You’re booked, ${firstName(b.clientName)}`,
    `<p style="margin:0 0 8px;font-size:15px;line-height:1.55">This confirms your session with ${esc(b.therapistName)}.</p>` +
    rows([['Session', esc(`${b.typeName}, ${b.min} min`)], ['When', esc(when)], ['Where', whereHtml], ['Fee', esc(money(b.fee))]]) +
    (policy ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#5E5850">${esc(policy)}</p>` : '') +
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#5E5850">To change or cancel, reply to this email.</p>` +
    `<p style="margin:0;font-size:13px;line-height:1.55;color:#5E5850">In crisis or thinking of harming yourself? Call Tele-MANAS on 14416, free and open all day, every day.</p>`);
  const text = [`You're booked, ${firstName(b.clientName)}.`, '', `This confirms your session with ${b.therapistName}.`, '',
    `Session: ${b.typeName}, ${b.min} min`, `When: ${when}`, `Where: ${whereText}`, `Fee: ${money(b.fee)}`, '', policy, 'To change or cancel, reply to this email.', '',
    'In crisis or thinking of harming yourself? Call Tele-MANAS on 14416, free and open all day, every day.'].filter((l) => l !== null).join('\n');
  return { subject, html, text };
}

// Sent to the therapist. It deliberately leaves out the client's intake answers.
function therapistEmail(b) {
  const when = whenText(b.start, b.tzOff);
  const subject = `New booking: ${b.clientName}, ${when}`;
  const html = shell('New booking',
    `<p style="margin:0 0 8px;font-size:15px;line-height:1.55">${esc(b.clientName)} booked a session from your booking page.</p>` +
    rows([['Session', esc(`${b.typeName}, ${b.min} min`)], ['When', esc(when)], ['Mode', esc(b.mode || 'Online')]]) +
    `<p style="margin:0;font-size:14px;line-height:1.55;color:#5E5850">Open your console to see their details and intake answers.</p>`);
  const text = [`${b.clientName} booked a session from your booking page.`, '', `Session: ${b.typeName}, ${b.min} min`, `When: ${when}`, `Mode: ${b.mode || 'Online'}`, '', 'Open your console to see their details and intake answers.'].join('\n');
  return { subject, html, text };
}

// Returns 'sent', 'skipped' (no key set) or 'failed'. Never throws.
async function sendMail({ to, subject, html, text, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return 'skipped';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'Practice <onboarding@resend.dev>', to: [to], subject, html, text, reply_to: replyTo || undefined }),
      signal: ctl.signal,
    });
    if (!r.ok) { console.error('mail failed', r.status); return 'failed'; }
    return 'sent';
  } catch (e) {
    console.error('mail failed', e.name);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { confirmationEmail, therapistEmail, sendMail, whenText };
