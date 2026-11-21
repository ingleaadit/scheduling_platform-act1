// Browser test: accessibility (axe, WCAG 2 A/AA) on the main screens, plus load time on slow networks.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const AX = require('axe-core').source;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
const srv = http.createServer((q, r) => { let u = q.url.split('?')[0].split('#')[0]; if (u === '/') u = '/index.html'; let f = path.join(ROOT, u); if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end('nf'); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(fs.readFileSync(f)); });
const R = []; const ok = (n, c, x) => R.push([c ? 'PASS' : 'FAIL', n, x || ''].join(' | '));
(async () => {
  await new Promise((r) => srv.listen(8798, r)); const br = await chromium.launch(); const B = 'http://localhost:8798';
  for (const [name, vp, url] of [['demo console, phone', { width: 390, height: 844 }, '/demo#therapist-phone'], ['demo console, desktop', { width: 1200, height: 850 }, '/demo#therapist-desktop'], ['booking page, phone', { width: 390, height: 844 }, '/demo#client-phone'], ['booking page, desktop', { width: 1200, height: 850 }, '/demo#client-desktop'], ['WhatsApp demo, phone', { width: 390, height: 844 }, '/demo#whatsapp-phone'], ['WhatsApp demo, desktop', { width: 1200, height: 850 }, '/demo#whatsapp-desktop'], ['404 page', { width: 390, height: 844 }, '/404.html']]) {
    const ctx = await br.newContext({ viewport: vp }); const pg = await ctx.newPage(); await pg.goto(B + url); await pg.waitForTimeout(700);
    await pg.evaluate(AX); const v = await pg.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map((x) => x.id + '(' + x.nodes.length + ')'));
    ok(name + ': no accessibility violations', v.length === 0, v.join(', ')); await ctx.close();
  }
  for (const [name, kbps, rtt, budget] of [['3G', 1600, 300, 8], ['slow 3G', 400, 400, 20]]) {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage(); const c = await ctx.newCDPSession(pg); await c.send('Network.enable');
    await c.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: kbps * 1024 / 8, uploadThroughput: kbps * 1024 / 8 });
    const t0 = Date.now(); await pg.goto(B + '/', { waitUntil: 'load' }); const s = (Date.now() - t0) / 1000;
    ok('page loads in under ' + budget + 's on ' + name, s < budget, s.toFixed(1) + 's'); await ctx.close();
  }
  await br.close(); srv.close(); console.log(R.join('\n'));
})();
