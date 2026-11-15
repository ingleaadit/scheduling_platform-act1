// Browser test. Run with: node tests/e2e/csp.e2e.js (or all of them: npm run test:e2e). Prints PASS/FAIL lines.
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT=require('path').resolve(__dirname,'..','..');const cfg=JSON.parse(fs.readFileSync(ROOT+'/vercel.json','utf8'));const H=Object.fromEntries(cfg.headers[0].headers.map(h=>[h.key,h.value]));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json','.jpg':'image/jpeg','.webmanifest':'application/manifest+json','.txt':'text/plain','.xml':'application/xml'};
const srv=http.createServer((q,r)=>{let u=q.url.split('?')[0];if(u==='/')u='/index.html';let f=path.join(ROOT,u);if(!fs.existsSync(f)&&fs.existsSync(f+'.html'))f+='.html';
 for(const k in H)r.setHeader(k,H[k]);
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.statusCode=404;r.setHeader('content-type','text/html');return r.end(fs.readFileSync(ROOT+'/404.html'))}
 r.setHeader('content-type',mime[path.extname(f)]||'application/octet-stream');r.end(fs.readFileSync(f))});
const R=[];const ok=(n,c,x)=>R.push([c?'PASS':'FAIL',n,x||''].join(' | '));
(async()=>{await new Promise(r=>srv.listen(8791,r));const br=await chromium.launch();const B='http://localhost:8791';
 for(const [name,url,vp] of [['client page','/',{width:390,height:844}],['demo (desktop)','/demo#therapist-desktop',{width:1200,height:850}],['demo (phone)','/demo#therapist-phone',{width:390,height:844}],['console sign-in','/console',{width:1200,height:850}],['admin page','/admin',{width:1200,height:850}],['404 page','/nothing-here',{width:390,height:844}]]){
  const ctx=await br.newContext({viewport:vp});const pg=await ctx.newPage();const viol=[],errs=[];
  await pg.addInitScript(()=>{window.__v=[];document.addEventListener('securitypolicyviolation',e=>window.__v.push(e.violatedDirective+' '+e.blockedURI))});
  pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error'&&!/supabase\.co|Failed to load resource|fonts\.g|ERR_/.test(m.text()))errs.push(m.text().slice(0,120))});
  await pg.goto(B+url);await pg.waitForTimeout(900);
  if(/demo/.test(url)){ await pg.evaluate(()=>{const b=document.querySelector('[data-a="tourReplay"]');if(b)b.click()});await pg.waitForTimeout(300);const f=await pg.$('[data-a="find"],.findbtn');if(f){await f.click().catch(()=>{});await pg.waitForTimeout(200)} }
  const v=await pg.evaluate(()=>window.__v||[]);
  ok(name+': no policy violations',v.filter(x=>!/fonts\.(googleapis|gstatic)/.test(x)).length===0,v.slice(0,3).join(' ; '));ok(name+': no script errors',errs.length===0,errs.slice(0,2).join(' | '));
  await ctx.close()}
 // headers present
 const r=await (await br.newContext()).request.get(B+'/demo');const h=r.headers();
 ok('security headers sent',h['x-content-type-options']==='nosniff'&&h['x-frame-options']==='DENY'&&/default-src/.test(h['content-security-policy']));
 const nf=await (await br.newContext()).request.get(B+'/nope');ok('unknown address gives the friendly 404',nf.status()===404&&/isn’t here/.test(await nf.text()));
 for(const f of ['/robots.txt','/sitemap.xml','/favicon.ico','/favicon.svg','/manifest.webmanifest','/og.png','/apple-touch-icon.png'])ok('serves '+f,(await (await br.newContext()).request.get(B+f)).status()===200);
 await br.close();srv.close();console.log(R.join('\n'))})();
