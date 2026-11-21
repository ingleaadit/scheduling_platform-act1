// Browser test: tablets and phones. iPads and Android tablets in portrait and landscape, touch input.
// Every screen must fit the width, show touch-sized controls and, in the WhatsApp view, keep the chat usable.
// Chromium emulates these devices (viewport, touch, user agent). It is not real Safari.
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { chromium, devices } = require('playwright');
const R = []; const ok = (n, c, x) => R.push([c ? 'PASS' : 'FAIL', n, x || ''].join(' | '));
const DEV = ['iPad Mini', 'iPad Mini landscape', 'iPad (gen 7)', 'iPad (gen 7) landscape', 'iPad Pro 11', 'iPad Pro 11 landscape', 'Galaxy Tab S4', 'Galaxy Tab S9', 'Galaxy Tab S9 landscape', 'iPhone SE', 'Pixel 7'];
// the signed-in console, as a therapist sees it (no demo frame): the demo page with the therapist side switched on
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-')) + '/ther.html';
fs.writeFileSync(tmp, fs.readFileSync(ROOT + '/demo.html', 'utf8').replace("window.APP_SIDE='demo'", "window.APP_SIDE='therapist'").replace('href="app.css"', 'href="file://' + ROOT + '/app.css"').replace('src="app.js"', 'src="file://' + ROOT + '/app.js"'));
const fit = () => document.documentElement.scrollWidth <= window.innerWidth + 1;
const small = () => { const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  return [...document.querySelectorAll('.mini,.chip,.linkbtn,.tabs button')].filter(vis).filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height)).slice(0, 4); };
(async () => {
  const br = await chromium.launch();
  for (const dn of DEV) {
    const d = devices[dn]; const ctx = await br.newContext({ viewport: d.viewport, isMobile: d.isMobile, hasTouch: d.hasTouch, userAgent: d.userAgent });
    const errs = []; const open = async (url) => { const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message)); await pg.goto(url); await pg.waitForTimeout(450); return pg; };
    const w = d.viewport.width, tag = dn + ' (' + w + 'px)';
    // therapist console, signed in
    let pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message)); await pg.goto('file://' + tmp); await pg.evaluate(() => localStorage.setItem('practice-proto-v1-auth', '1')); await pg.reload(); await pg.waitForTimeout(450);
    ok(tag + ': touch screen is detected', await pg.evaluate(() => matchMedia('(pointer:coarse)').matches));
    ok(tag + ': console fits the width', await pg.evaluate(fit)); const s1 = await pg.evaluate(small); ok(tag + ': console buttons are 44px or taller', s1.length === 0, s1.join(' '));
    const pay = await pg.$('[data-a="tab"][data-v="people"]'); if (pay) { await pay.click(); await pg.waitForTimeout(200); const sub = await pg.$('[data-a="tab"][data-v="payments"]'); if (sub) { await sub.click(); await pg.waitForTimeout(200); ok(tag + ': payments fits the width', await pg.evaluate(fit)); const s2 = await pg.evaluate(small); ok(tag + ': payments buttons are 44px or taller', s2.length === 0, s2.join(' ')); } }
    await pg.close();
    // booking page
    pg = await open('file://' + ROOT + '/index.html'); ok(tag + ': booking page fits the width', await pg.evaluate(fit));
    await pg.click('[data-a="startBook"]'); await pg.waitForTimeout(250); ok(tag + ': booking time step fits the width', await pg.evaluate(fit)); await pg.close();
    // WhatsApp view
    pg = await open('file://' + ROOT + '/demo.html#whatsapp-' + (w < 640 ? 'phone' : 'desktop'));
    ok(tag + ': WhatsApp view fits the width', await pg.evaluate(fit));
    const g = await pg.evaluate(() => { const r = (q) => { const e = document.querySelector(q); return e && e.getBoundingClientRect(); }; return { nav: r('.wasc'), ph: r('.phone'), inp: r('#wain'), msgs: r('.wamsgs'), w: innerWidth, h: innerHeight }; });
    ok(tag + ': the chat input sits inside the phone', g.inp && g.ph && g.inp.top >= g.ph.top && g.inp.bottom <= g.ph.bottom + 1);
    if (w >= 760) ok(tag + ': scenario list sits beside the phone', g.nav.right <= g.ph.left + 1, 'nav.right=' + Math.round(g.nav.right) + ' phone.left=' + Math.round(g.ph.left));
    else ok(tag + ': scenario list stacks above the phone, in one row', g.nav.bottom <= g.ph.top + 1 && g.nav.height < 90, 'nav.h=' + Math.round(g.nav.height));
    await pg.locator('.waq button').first().tap(); await pg.waitForTimeout(150);
    const wt = await pg.innerText('.wamsgs'); ok(tag + ': a tap on a chat option works', /Free to move|under 24 hours/.test(wt));
    const s3 = await pg.evaluate(() => [...document.querySelectorAll('.waq button,.wasb,.wasend')].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().height)));
    ok(tag + ': chat controls are 44px or taller', s3.length === 0, s3.join(' ')); await pg.close();
    ok(tag + ': no page errors', errs.length === 0, errs.join('|')); await ctx.close();
  }
  await br.close(); console.log(R.join('\n'));
})();
