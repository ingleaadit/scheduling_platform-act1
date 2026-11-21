// Browser test: the WhatsApp booking demo (six scripted chats on the demo data). Prints PASS/FAIL lines.
const ROOT = require('path').resolve(__dirname, '..', '..');
const { chromium } = require('playwright');
const R = []; const ok = (n, c, x) => R.push([c ? 'PASS' : 'FAIL', n, x || ''].join(' | '));
const KEY = 'practice-proto-v1';
(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1100, height: 900 } }); const pg = await ctx.newPage();
  const errs = [], reqs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('request', (r) => { if (!r.url().startsWith('file:')) reqs.push(r.url()); });
  const data = () => pg.evaluate((k) => JSON.parse(localStorage.getItem(k)).data, KEY);
  const txt = async () => (await pg.innerText('.wamsgs')).replace(/\n+/g, ' | ');
  const tap = async (l) => { await pg.click(`.waq button:has-text("${l}")`); };
  const tapN = async (n) => { await pg.locator('.waq button').nth(n).click(); };
  const say = async (t) => { await pg.fill('#wain', t); await pg.press('#wain', 'Enter'); };
  const scen = async (id) => { await pg.click(`[data-a="waSc"][data-v="${id}"]`); };
  const fresh = async () => { await pg.goto('file://' + ROOT + '/demo.html'); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await pg.waitForTimeout(300); await pg.click('[data-a="view"][data-v="whatsapp"]'); };

  // the WhatsApp view exists on the demo only
  for (const f of ['index.html', 'console.html']) { await pg.goto('file://' + ROOT + '/' + f); await pg.waitForTimeout(200); ok(f + ': no WhatsApp button', !(await pg.$('#wabtn'))); }
  await fresh();
  ok('demo: WhatsApp view opens with six scenarios', (await pg.$$('.wasb')).length === 6 && /Hi Vikram/.test(await txt()));

  // 1. move or cancel
  await tap('Move it'); await say('thursday evening');
  let t = await txt(); ok('1: a typed "thursday evening" is read and filtered to Thursday evening slots', /Open .*evenings/.test(t) && !/Mon, \d+ Nov/.test(t.slice(t.indexOf('Open'))));
  await tapN(0); await tap('Confirm');
  let d = await data(); const vik = d.appts.filter((a) => a.name === 'Vikram Joshi' && a.status === 'upcoming' && a.start > Date.now());
  ok('1: confirming moves the session on the console data', vik.length === 1 && new Date(vik[0].start).getDay() === 4 && new Date(vik[0].start).getHours() >= 17 && vik[0].isNew === true, vik.map((a) => new Date(a.start).toString()).join());
  await scen('resched'); await tap('Demo: pretend'); await tap('Move it');
  t = await txt(); d = await data(); ok('1: inside the 24-hour window it will not move the session itself', /under 24 hours/.test(t) && /Ask Meera to move it/.test(t));
  await tap('Ask Meera to move it'); ok('1: ...and passes it to Meera', /I’ve asked Meera/.test(await txt()));
  await scen('resched'); await tap('Demo: pretend'); await tap('Cancel it'); await tap('Yes, cancel');
  d = await data(); const lateC = d.appts.find((a) => a.name === 'Vikram Joshi' && a.status === 'cancelled' && a.late);
  ok('1: a late cancel charges the policy fee (50% of 1500)', !!lateC && lateC.lateFee === 750, JSON.stringify(lateC && lateC.lateFee));
  await scen('resched'); await tap('Cancel it'); await tap('Yes, cancel');
  d = await data(); ok('1: a cancel outside the window is free', d.appts.some((a) => a.name === 'Vikram Joshi' && a.status === 'cancelled' && !a.late && a.lateFee === 0));

  // 2. waitlist backfill
  await fresh(); await scen('backfill');
  t = await txt(); const wl0 = (await data()).waitlist.length; ok('2: a cancellation is offered to the first person on the waitlist', /Hi Aisha/.test(t) && wl0 === 3);
  await tap('Stop these messages'); t = await txt(); d = await data();
  ok('2: "stop" removes them from the waitlist and the next person is asked', !d.waitlist.some((w) => w.name === 'Aisha Khan') && /Hi Nikhil/.test(t));
  await tap('Demo: 2 hours'); ok('2: no reply lapses the offer and the slot stays open', /Nobody else/.test(await txt()));
  await scen('backfill'); await tap('Yes, book it'); d = await data();
  const ai = d.appts.find((a) => a.name === 'Aisha Khan' && a.status === 'upcoming');
  ok('2: accepting books them and takes them off the waitlist', !!ai && ai.source === 'From waitlist' && !d.waitlist.some((w) => w.name === 'Aisha Khan'));

  // 3. new enquiry: intake and consent in the chat, appointment made automatically
  await fresh(); await scen('enquiry'); await tap('Fees and languages'); ok('3: fees and languages are answered', /Languages: English, Hindi, Malayalam/.test(await txt()));
  await tap('Book a first session'); await tap('Hindi'); await tap('Online'); await tap('Reduced fee'); await tapN(0); await say('Rhea Kapoor');
  ok('3: it asks the intake questions one by one', /How old are you\?/.test(await txt()));
  await say('abc'); ok('3: a non-number age is refused', /just a number/.test(await txt()));
  await say('27'); await say('she/her'); await say('Pune'); await tap('No'); await tap('Instagram');
  t = await txt(); d = await data();
  ok('3: the clinical question is kept off the chat and goes to a secure form', /secure form instead of this chat/.test(t) && !/Describe your issue/.test(t));
  ok('3: nothing is booked until the client agrees', !d.appts.some((a) => a.name === 'Rhea Kapoor') && /I agree and book/.test(t));
  await tap('Read the full policy'); ok('3: the full policy is one tap away', /14416/.test(await txt()) && /Cancellation policy/.test(await txt()));
  await tap('I agree and book'); d = await data(); const rh = d.appts.find((a) => a.name === 'Rhea Kapoor');
  ok('3: agreeing makes the appointment by itself, with intake answers and consent time', !!rh && rh.source === 'WhatsApp' && rh.type === 'reduced' && rh.fee === 700 && rh.isNew && !!rh.consentAt && rh.intake.length === 5 && rh.intake.some((q) => q.label === 'Where are you from?' && q.answer === 'Pune') && !rh.intake.some((q) => q.private), JSON.stringify(rh && rh.intake));
  await scen('enquiry'); await tap('Book a first session'); await tap('Another language'); ok('3: a language Meera does not offer goes to her', /suggest someone/.test(await txt()));
  await scen('enquiry'); await tap('Book a first session'); await tap('English'); await tap('In person'); await tap('First session'); await tapN(0); await say('Zed'); await say('27'); await say('he/him'); await say('Goa'); await tap('Not sure'); await tap('Google'); await tap('No thanks');
  d = await data(); ok('3: declining consent books nothing and keeps nothing', !d.appts.some((a) => a.name === 'Zed') && /haven’t kept your answers/.test(await txt()));
  await scen('enquiry'); await tap('Book a first session'); await tap('English'); await tap('Online'); await tap('First session'); await tapN(0); await say('Teen Test'); await say('16'); await say('they/them'); await say('Pune'); await tap('Yes'); await tap('Friend');
  ok('3: under 18 asks for a guardian', /parent or guardian’s agreement/.test(await txt()));
  await say('Sunita, mother'); ok('3: a guardian number is required', /10-digit number/.test(await txt()));
  await say('Sunita, mother, 98765 12345'); ok('3: the guardian is messaged', /Sent to \+91 98765 12345/.test(await txt()));
  await tap('I agree and book'); d = await data(); const tt = d.appts.find((a) => a.name === 'Teen Test');
  ok('3: the minor is booked with the guardian recorded', !!tt && tt.guardian && tt.guardian.name === 'Sunita' && tt.guardian.rel === 'mother' && /held until they do/.test(await txt()));

  // 4. therapist's own chat
  await fresh(); await scen('ther'); await tap('Who’s tomorrow'); ok('4: "who is tomorrow" lists the day', /(sessions?\.|nothing booked)/.test(await txt()));
  await scen('ther'); await tap('Move Vikram'); t = await txt(); ok('4: it asks before moving anything', /Move Vikram Joshi from .* to Thursday/.test(t) && /Yes, move and tell them/.test(t));
  d = await data(); const before = d.appts.find((a) => a.name === 'Vikram Joshi' && a.start > Date.now()).start;
  await tap('Yes, move and tell them'); d = await data(); const after = d.appts.find((a) => a.name === 'Vikram Joshi' && a.start > Date.now());
  ok('4: confirming moves it to Thursday 5 pm and drafts the message to the client', after.start !== before && new Date(after.start).getDay() === 4 && new Date(after.start).getHours() === 17 && /Sent to Vikram/.test(await txt()));
  await scen('ther'); await tap('Voice note'); t = await txt(); ok('4: a Hinglish voice note is heard and understood', !!(await pg.$('.wvo')) && /I heard: “Vikram ka session Thursday shaam/.test(t) && /Open times for Vikram/.test(t));
  await scen('ther'); await tap('Block Friday evening'); await tap('Block it'); d = await data();
  const blk = d.blocks.find((b) => b.note === 'Blocked from WhatsApp'); ok('4: "Block Friday evening" blocks 5 to 8 pm on a Friday', !!blk && new Date(blk.date).getDay() === 5 && blk.from === '17:00' && blk.to === '20:00');
  await say('hello there'); ok('4: anything else gets a short list of what it can do', /I can tell you who’s coming/.test((await txt()).slice(-300)));

  // 5. booking for someone else
  await fresh(); await scen('family'); await tap('My child'); await tap('No, I’m not'); ok('5: someone who is not a guardian cannot book for a child', /Meera can’t start without them/.test(await txt()));
  await scen('family'); await tap('My child'); await tap('Yes, I am'); await say('Sunita Rao, mother'); await say('Aarav'); await tapN(0); await tap('Yes, I agree');
  d = await data(); const aar = d.appts.find((a) => a.name === 'Aarav Rao');
  ok('5: a child is booked with the guardian and consent time recorded', !!aar && aar.guardian && aar.guardian.name === 'Sunita Rao' && aar.guardian.rel === 'mother' && !!aar.consentAt);
  await scen('family'); await tap('My partner'); await say('98765 12345'); t = await txt();
  ok('5: an adult is messaged first with a neutral message that gives no reason', /Sent to \+91 98765 12345: “Hi, this is MN Practice\. Someone gave us this number/.test(t) && !/therap|counsel|session for/i.test(t.match(/Sent to \+91[^|]*/)[0]));
  await tap('Demo: they reply YES'); await say('Imran Khan'); await tapN(0); await tap('Yes, book it'); d = await data();
  const imr = d.appts.find((a) => a.name === 'Imran Khan'); ok('5: after their YES the booking is under their own name and number', !!imr && imr.wa === '+91 98765 12345');

  // 6. pay to confirm
  await fresh(); await scen('pay'); await tapN(0); ok('6: a slot is held while the client pays', /held .* for you for 15 minutes/.test(await txt()));
  await tap('Pay ₹1,500'); await say('12345'); ok('6: a short UTR is refused', /A UTR has 12 digits/.test(await txt()));
  await say('612345678901'); d = await data(); const rm = d.appts.find((a) => a.name === 'Riya Menon' && a.claimed);
  ok('6: a 12-digit UTR books it as claimed, not as paid', !!rm && rm.claimUtr === '612345678901' && rm.paid === false);
  await scen('pay'); await tapN(1); await tap('Demo: 15 minutes pass'); d = await data(); ok('6: an unpaid hold is released and nothing is booked', /hold on .* has ended/.test(await txt()) && !d.appts.some((a) => a.name === 'Riya Menon' && a.claimed && a.id !== rm.id));

  await scen('pay'); await tapN(0); ok('6: the UPI step says WhatsApp or any UPI app works', /WhatsApp or any UPI app/.test(await txt())); await tap('Demo: Meera has a payment gateway');
  ok('6: with a gateway the request is an order with a Pay now button', /Total ₹1,500/.test(await txt()) && !!(await pg.$('.waq button:has-text("Pay now")')));
  await tap('Pay now'); d = await data(); const gw = d.appts.filter((a) => a.name === 'Riya Menon' && a.paid && a.status === 'upcoming' && a.pay && a.pay.utr);
  ok('6: with a gateway it is booked and marked paid with a UTR, no manual check', gw.length === 1 && gw[0].pay.amount === 1500 && !gw[0].claimed);

  // safety: self-harm words stop the flow in every client chat
  for (const sc of ['resched', 'enquiry', 'family', 'pay']) {
    await scen(sc); const n0 = (await data()).appts.length; await say('I just want to die'); t = await txt();
    ok('safety (' + sc + '): shows Tele-MANAS 14416 and stops the booking flow', /14416/.test(t) && !(await pg.$('.waq')) && (await data()).appts.length === n0);
    await say('ok book me'); ok('safety (' + sc + '): later messages go to Meera, not the flow', /passed your message to Meera/.test((await txt()).slice(-260)));
    await pg.click('.wahb'); ok('safety (' + sc + '): Restart clears it', !/14416/.test(await txt()));
  }

  // the console sees what the chat did
  await pg.click('[data-a="view"][data-v="therapist"]'); await pg.waitForTimeout(300);
  ok('console: still works after the chats', !(await pg.$('form[data-form="login"]')));

  // phone width
  const p2 = await (await br.newContext({ viewport: { width: 390, height: 844 } })).newPage(); p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto('file://' + ROOT + '/demo.html#whatsapp-phone'); await p2.waitForTimeout(400);
  ok('phone: no sideways scrolling', await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok('phone: the chat and the scenario list are both there', !!(await p2.$('.wamsgs')) && (await p2.$$('.wasb')).length === 6);

  ok('no network calls (example data only)', reqs.filter((u) => !/fonts\.(googleapis|gstatic)/.test(u)).length === 0, reqs.slice(0, 3).join(' '));
  ok('no page errors', errs.length === 0, errs.join('|'));
  await br.close(); console.log(R.join('\n'));
})();
