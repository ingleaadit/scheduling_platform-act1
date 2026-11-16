// Browser test. Run with: node tests/e2e/nav.e2e.js (or all of them: npm run test:e2e). Prints PASS/FAIL lines.
const ROOT=require('path').resolve(__dirname,'..','..');
const { chromium } = require('playwright');
const SD=require('os').tmpdir()+'/';
const R=[];const ok=(n,c,x)=>R.push([c?'PASS':'FAIL',n,x||''].join(' | '));
const store=pg=>pg.evaluate(()=>{const k=Object.keys(localStorage).find(k=>/practice|proto/i.test(k)&&!/auth/.test(k));return JSON.parse(localStorage.getItem(k)).data});
(async()=>{const br=await chromium.launch();
 for(const [label,vp,hash] of [['phone',{width:390,height:844},'#therapist-phone'],['desktop',{width:1200,height:850},'#therapist-desktop']]){
  const ctx=await br.newContext({viewport:vp,deviceScaleFactor:1});const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto('file://'+ROOT+'/src/prototype.html'+hash);await pg.waitForSelector('form[data-form="login"]');
  await pg.click('[data-a="fillDemo"]');await pg.click('form[data-form="login"] button[type=submit]');await pg.waitForSelector('form[data-form="login"]',{state:'detached'});await pg.waitForTimeout(400);
  const head=await pg.innerHTML('header.mhead,header.tnav');
  ok(label+': header has an undo arrow',/data-a="undo"/.test(head));
  ok(label+': undo is greyed out before any change',await pg.isDisabled('[data-a="undo"]'));
  ok(label+': header has a bell',/data-v="notifs"/.test(head));
  ok(label+': Hide names is not in the header',!/Hide names/.test(head));
  if(label==='phone'){
   ok('phone: header has a search icon',/aria-label="Search or add"/.test(head));
   const nav=await pg.innerText('nav.tabbar');ok('phone: tabs are Today, Calendar, Clients, Payments, Settings',/Today[\s\S]*Calendar[\s\S]*Clients[\s\S]*Payments[\s\S]*Settings/.test(nav)&&!/Sessions/.test(nav),nav.replace(/\n+/g,' | '));
   await pg.click('.mhead [aria-label="Search or add"]');await pg.waitForSelector('#findq');ok('phone: search icon opens search',true);await pg.fill('#findq','Vikram');await pg.waitForTimeout(150);ok('phone: search finds a client',/Vikram Joshi/.test(await pg.innerText('#findres')));
   await pg.click('[data-a="close"]');
   await pg.click('nav.tabbar [data-v="cal"]');await pg.waitForTimeout(200);let t=await pg.innerText('.twrap');ok('phone: Calendar tab shows a calendar',/Calendar/.test(t)&&/Today/.test(t)&&await pg.isVisible('.calbar'),t.slice(0,80).replace(/\n+/g,' | '));await pg.screenshot({path:SD+'nav_phone_cal.png'});
   await pg.click('nav.tabbar [data-v="schedule"]');t=await pg.innerHTML('.twrap');ok('phone: Today no longer repeats the calendar',!/class="calbar"/.test(t));
   await pg.click('nav.tabbar [data-v="people"]');await pg.waitForTimeout(150);
   ok('phone: Clients has a Clients/Sessions switch',await pg.isVisible('.twrap .seg [data-v="appts"]'));await pg.screenshot({path:SD+'nav_phone_clients.png'});
   await pg.click('.twrap .seg [data-v="appts"]');await pg.waitForTimeout(150);t=await pg.innerText('.twrap');ok('phone: Sessions list opens inside Clients',/Sessions|Upcoming/.test(t)&&await pg.isVisible('.seg [aria-pressed="true"]'));
   ok('phone: Clients tab stays highlighted on Sessions',await pg.getAttribute('nav.tabbar [data-v="people"]','aria-current')==='page');
   await pg.click('nav.tabbar [data-v="more"]');t=await pg.innerText('.twrap');ok('phone: Hide names is in Settings',/Hide names/.test(t));
   await pg.click('nav.tabbar [data-v="schedule"]');
  }
  // undo round trip: Mark confirmed on the first unconfirmed session
  if(await pg.$('[data-k="t.todoOpen"][data-v="1"]')){await pg.click('[data-k="t.todoOpen"][data-v="1"]');await pg.waitForTimeout(150)}
  const btn=await pg.$('[data-a="quickLabel"][data-v="confirmed"]');ok(label+': a Mark confirmed button exists',!!btn);
  if(btn){const id=await btn.getAttribute('data-id');
   const b4=JSON.stringify((await store(pg)).appts.find(a=>a.id===id));await btn.click();await pg.waitForTimeout(250);
   const mid=JSON.stringify((await store(pg)).appts.find(a=>a.id===id));ok(label+': action changed the session',mid!==b4,'');
   ok(label+': undo arrow is now active',!(await pg.isDisabled('[data-a="undo"]')));
   await pg.click('[data-a="undo"]');await pg.waitForTimeout(300);
   const aft=JSON.stringify((await store(pg)).appts.find(a=>a.id===id));ok(label+': undo put it back',aft===b4,'');
   ok(label+': undo is greyed out again',await pg.isDisabled('[data-a="undo"]'));
   ok(label+': a toast says Undone',/Undone/.test(await pg.innerText('#toast')));
   await pg.screenshot({path:SD+`nav_${label}_head.png`});
  }
  ok(label+': no page errors',errs.length===0,errs.join('|'));await ctx.close()}
 await br.close();console.log(R.join('\n'))})();
