// Browser test. Run with: node tests/e2e/demo.e2e.js (or all of them: npm run test:e2e). Prints PASS/FAIL lines.
const ROOT=require('path').resolve(__dirname,'..','..');
const { chromium } = require('playwright');
const SD=require('os').tmpdir()+'/';
const R=[];const ok=(n,c,x)=>R.push([c?'PASS':'FAIL',n,x||''].join(' | '));
(async()=>{const br=await chromium.launch();
 for(const [label,vp] of [['phone',{width:390,height:844}],['desktop',{width:1200,height:850}]]){
  const ctx=await br.newContext({viewport:vp});const pg=await ctx.newPage();const errs=[],reqs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('request',r=>{if(!r.url().startsWith('file:'))reqs.push(r.url())});
  await pg.goto('file://'+ROOT+'/demo.html');await pg.waitForTimeout(600);
  ok(label+': opens straight into the console with no login',!(await pg.$('form[data-form="login"]'))&&(await pg.$('header.mhead,header.tnav'))!==null);
  const t=await pg.innerText('body');ok(label+': says it is example data',/Example data\. Nothing is sent or shared/.test(t));
  ok(label+': shows example sessions to try',/Vikram Joshi/.test(t));
  await pg.screenshot({path:SD+`demo_${label}.png`});
  // toggle to the client booking page
  await pg.click('[data-a="view"][data-v="client"]');await pg.waitForTimeout(300);ok(label+': Client toggle shows the booking page',/Book|session|Meera/.test(await pg.innerText('body'))&&!!(await pg.$('.sw-t')));
  await pg.click('[data-a="view"][data-v="therapist"]');await pg.waitForTimeout(300);
  ok(label+': back to the console, still signed in',!(await pg.$('form[data-form="login"]')));
  ok(label+': no network calls (example data only)',reqs.filter(u=>!/fonts\.(googleapis|gstatic)/.test(u)).length===0,reqs.slice(0,3).join(' '));
  ok(label+': no page errors',errs.length===0,errs.join('|'));await ctx.close()}
 await br.close();console.log(R.join('\n'))})();
