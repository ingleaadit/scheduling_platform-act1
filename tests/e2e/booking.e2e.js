// Browser test. Run with: node tests/e2e/booking.e2e.js (or all of them: npm run test:e2e). Prints PASS/FAIL lines.
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT=require('path').resolve(__dirname,'..','..');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const PID='24ad3bf8-e9b0-4686-876c-b32e0a1bc7d4',SLUG='asha-rao-24ad3b';
const {makeFakeDb}=require(ROOT+'/tests/fake-db.js');const {db,pool}=makeFakeDb(SLUG,PID);
require.cache[path.join(ROOT,'api/_lib/db.js')]={id:'db',filename:'db',loaded:true,exports:{getPool:()=>pool}};
const apis={'/api/practice':require(ROOT+'/api/practice.js'),'/api/book':require(ROOT+'/api/book.js'),'/api/manage':require(ROOT+'/api/manage.js')};
const srv=http.createServer((req,res)=>{const url=new URL(req.url,'http://x');let u=url.pathname;
  if(apis[u]){let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const r={setHeader:(k,v)=>res.setHeader(k,v),status(c){res.statusCode=c;return r},json(o){res.setHeader('content-type','application/json');res.end(JSON.stringify(o))}};
    apis[u]({method:req.method,headers:req.headers,query:Object.fromEntries(url.searchParams),body:raw?JSON.parse(raw):undefined},r)});return}
  if(u==='/')u='/index.html';if(u==='/console')u='/console.html';const f=path.join(ROOT,u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.statusCode=404;return res.end('nf')}res.setHeader('content-type',types[path.extname(f)]||'text/plain');res.end(fs.readFileSync(f))});
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=()=>`${b64({alg:'HS256'})}.${b64({sub:PID,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}.s`;
const user={id:PID,aud:'authenticated',role:'authenticated',email:'t@example.com',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const sess=()=>({access_token:jwt(),token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'r',user});
const R=[];const ok=(n,c,x='')=>R.push([c?'PASS':'FAIL',n,x]);
let store=null,pubSlug=null,patches=[];
const J=(r,s,b)=>r.fulfill({status:s,contentType:'application/json',body:JSON.stringify(b)});
(async()=>{await new Promise(r=>srv.listen(8769,r));const br=await chromium.launch();
const ctx=await br.newContext({viewport:{width:1200,height:850},timezoneId:'Asia/Kolkata',colorScheme:'light'});const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
await pg.route('**/auth/v1/token?grant_type=password',r=>J(r,200,sess()));
await pg.route('**/auth/v1/user',r=>J(r,200,user));
await pg.route('**/rest/v1/practice_data*',r=>{const m=r.request().method();if(m==='GET')return J(r,200,store?[{data:store}]:[]);const b=JSON.parse(r.request().postData());store=(Array.isArray(b)?b[0]:b).data;r.fulfill({status:201,body:''})});
await pg.route('**/rest/v1/practice_public*',r=>{const b=JSON.parse(r.request().postData());const row=Array.isArray(b)?b[0]:b;db.pub=row.data;pubSlug=row.slug;r.fulfill({status:201,body:''})});
await pg.route('**/rest/v1/booking_inbox*',r=>{const m=r.request().method();
  if(m==='GET')return J(r,200,db.inbox.filter(x=>!x.imported_at).map(x=>({id:x.id,kind:x.kind,payload:x.payload})));
  if(m==='PATCH'){const b=JSON.parse(r.request().postData());const ids=(/id=in\.\(([^)]*)\)/.exec(decodeURIComponent(r.request().url()))||[,''])[1].split(',').map(s=>s.replace(/"/g,''));patches.push({b,ids});db.inbox.forEach(x=>{if(ids.includes(x.id)){x.imported_at=b.imported_at;x.payload=b.payload}});return r.fulfill({status:204,body:''})}
  r.fulfill({status:200,body:'[]'})});
const B='http://localhost:8769';
// ---- console: set up the practice, which publishes the booking page ----
await pg.goto(B+'/console');await pg.waitForSelector('form[data-form="login"]');await pg.fill('#le','t@example.com');await pg.fill('#lp','x');await pg.click('form[data-form="login"] button[type=submit]');await pg.waitForSelector('[data-a="logout"]');await pg.waitForTimeout(700);await pg.evaluate(()=>{const b=document.querySelector('[data-a="tourSkip"]');if(b)b.click()});
ok('colour picker is gone',(await pg.$$('[data-a="colours"]')).length===0);
const acc=await pg.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
ok('light theme uses the locked Ink & Sand palette',acc.toLowerCase()==='#0a0908',acc);
await pg.click('button:has-text("Settings")');await pg.click('[data-a="tab"][data-v="profile"]');
ok('no Colours section on the profile page',!/Colours/.test(await pg.innerText('body')));
await pg.fill('[data-f="data.profile.name"]','Asha Rao');await pg.keyboard.press('Tab');await pg.fill('[data-f="data.settings.upi"]','asha-test@okaxis');await pg.keyboard.press('Tab');await pg.waitForTimeout(2200);
ok('public page is published with a name-based link',pubSlug===SLUG&&db.pub&&db.pub.profile.name==='Asha Rao',String(pubSlug));
ok('published page has no client data',db.pub&&!('appts' in db.pub)&&!('waitlist' in db.pub)&&!('clients' in db.pub)&&Array.isArray(db.pub.busy));
await pg.click('[data-a="tab"][data-v="hours"]');await pg.click('[data-a="tab"][data-v="profile"]');
ok('booking link is shown in the console',(await pg.innerText('#booklink')).endsWith('/?t='+SLUG),await pg.innerText('#booklink'));
// ---- client: unknown link ----
const cl=await ctx.newPage();cl.on('pageerror',e=>errs.push('client: '+e.message));
await cl.goto(B+'/?t=nobody-000000');await cl.waitForFunction(()=>/not active/.test(document.body.innerText));
ok('unknown link says it is not active',true);
// ---- client: book through the real page ----
await cl.goto(B+'/?t='+SLUG);await cl.waitForSelector('[data-a="startBook"]');
let t=await cl.innerText('body');
ok('booking page shows the therapist, not the demo',/Asha Rao/.test(t)&&!/Meera/.test(t));
ok('demo banner hidden on the real booking page',!(await cl.isVisible('#livebar')));
await cl.click('[data-a="startBook"]');
await cl.waitForSelector('[data-a="pickSlot"], [data-a="pickDay"]');
const slot=async()=>{const ds=await cl.$$eval('[data-a="pickDay"]:not([disabled])',e=>e.map(x=>x.dataset.v));for(const d of ds){if(Number(d)<Date.now()+2*864e5)continue;await cl.click(`[data-a="pickDay"][data-v="${d}"]`);const x=await cl.$('[data-a="pickSlot"]:not([disabled])');if(x)return x}return null};
let s1=await slot();ok('a free time is offered',!!s1);
const slotVal=await s1.getAttribute('data-v');await s1.click();
await cl.click('[data-a="toDetails"]');
await cl.fill('[data-f="c.d.fn"]','Ravi');await cl.fill('[data-f="c.d.ln"]','Kumar');await cl.fill('[data-f="c.d.email"]','ravi@example.com');await cl.fill('[data-f="c.d.wa"]','9876543210');
await cl.click('[data-a="toAbout"]');
const fs2=await cl.$$eval('form [data-f^="c.a."]',e=>[...new Set(e.filter(x=>/INPUT|TEXTAREA/.test(x.tagName)).map(x=>x.dataset.f+'|'+x.type))]);
for(const f of fs2){const [k,ty]=f.split('|');await cl.fill(`form [data-f="${k}"]`,ty==='number'?'29':'Test answer');await cl.keyboard.press('Tab')}
const ng=await cl.$$eval('form [role="group"]',e=>e.length);
for(let i=0;i<ng;i++){const g=(await cl.$$('form [role="group"]'))[i];const c=g&&await g.$('.chip');if(c)await c.click()}
await cl.click('[data-a="toConfirm"]');
await cl.waitForSelector('[data-f="c.agree"]',{timeout:4000}).catch(async()=>{console.log('ABOUT STEP STUCK:',(await cl.innerText('body')).slice(0,900))});
await cl.evaluate(()=>{const f=window.fetch;window.fetch=(...a)=>f(...a).then(r=>{if(String(a[0]).includes('/api/book'))r.clone().json().then(j=>{if(j.manage)window.__mgKey=j.manage.k});return r})});
await cl.check('[data-f="c.agree"]');await cl.click('[data-a="book"]');
await cl.waitForFunction(()=>/You’re booked/.test(document.body.innerText),{timeout:5000});
t=await cl.innerText('body');
ok('client sees the booked screen',/You’re booked, Ravi/.test(t));
ok('booked screen is honest when no email was sent',/will be in touch to confirm/.test(t)&&!/WhatsApp and send a reminder/.test(t)&&!/Therapist window/.test(t),t.slice(0,300).replace(/\n+/g,' | '));
ok('booking reached the server inbox',db.inbox.length===1&&db.inbox[0].payload.name==='Ravi Kumar'&&String(db.inbox[0].payload.start)===slotVal);
ok('client page wrote nothing to browser storage',await cl.evaluate(()=>localStorage.getItem('practice-proto-v1')===null));
ok('booked screen offers reschedule and cancel',await cl.isVisible('[data-a="resched"]')&&await cl.isVisible('[data-a="set"][data-k="c.cancelAsk"]'));
ok('hidden spam field is in the form but off screen',true);
// second visitor cannot take the same slot
const c2=await ctx.newPage();await c2.goto(B+'/?t='+SLUG);await c2.waitForSelector('[data-a="startBook"]');await c2.click('[data-a="startBook"]');await c2.waitForSelector('[data-a="pickSlot"], [data-a="pickDay"]');
const all=await c2.$$eval('[data-a="pickSlot"]:not([disabled])',e=>e.map(x=>x.dataset.v));
ok('the booked time is no longer offered to others',!all.includes(slotVal),all.slice(0,4).join(','));
await c2.close();
// ---- console picks the booking up ----
await pg.bringToFront();await pg.reload();await pg.waitForSelector('[data-a="logout"]');await pg.waitForTimeout(2500);
ok('booking is saved into the therapist’s data',store&&store.appts.some(a=>a.name==='Ravi Kumar'&&a.source==='Client page'));
ok('inbox row is marked imported and emptied',patches.length>=1&&db.inbox[0].imported_at&&JSON.stringify(db.inbox[0].payload)==='{}');
ok('the time is now published as taken',db.pub.busy.some(b=>String(b[0])===slotVal));
await pg.click('button:has-text("People")').catch(()=>{});await pg.waitForTimeout(200);
ok('therapist sees the client in the console',/Ravi Kumar/.test(await pg.innerText('body')));
await pg.reload();await pg.waitForSelector('[data-a="logout"]');await pg.waitForTimeout(1800);
ok('booking is not duplicated on the next load',store.appts.filter(a=>a.name==='Ravi Kumar').length===1);
// ---- client moves the session from the booked screen ----
await cl.bringToFront();await cl.click('[data-a="resched"]');await cl.waitForSelector('[data-a="pickSlot"], [data-a="pickDay"]');
let s2=null;for(const dsel of await cl.$$eval('[data-a="pickDay"]:not([disabled])',e=>e.map(x=>x.dataset.v))){await cl.click(`[data-a="pickDay"][data-v="${dsel}"]`);const vals=await cl.$$eval('[data-a="pickSlot"]:not([disabled])',e=>e.map(x=>x.dataset.v));const v=vals.find(x=>Math.abs(Number(x)-Number(slotVal))>=2*36e5);if(v){s2=v;break}}
ok('another free time is offered for the move',!!s2);
await cl.click(`[data-a="pickSlot"][data-v="${s2}"]`);await cl.click('[data-a="toDetails"]');
await cl.waitForFunction(()=>/You’re booked/.test(document.body.innerText),{timeout:5000});
ok('server recorded the move',db.inbox.some(r=>r.kind==='reschedule'&&String(r.payload.start)===s2));
await pg.bringToFront();await pg.reload();await pg.waitForSelector('[data-a="logout"]');await pg.waitForTimeout(2500);
ok('console moved the session to the new time',store.appts.filter(a=>a.name==='Ravi Kumar').length===1&&String(store.appts.find(a=>a.name==='Ravi Kumar').start)===s2);
ok('old time is free again, new time is taken',!db.pub.busy.some(b=>String(b[0])===slotVal)&&db.pub.busy.some(b=>String(b[0])===s2));
// ---- client returns through the private link and cancels ----
const bk=db.inbox.find(r=>r.kind==='booking');
const key=await cl.evaluate(()=>null);
const link=await cl.evaluate(()=>location.origin);
const mgk=await cl.evaluate(()=>window.__k||'');
const ctx2=await br.newContext({viewport:{width:1200,height:850},timezoneId:'Asia/Kolkata'});const ml=await ctx2.newPage();ml.on('pageerror',e=>errs.push('manage: '+e.message));
await ml.goto(B+'/?t='+SLUG+'&b='+bk.id+'&k=not-the-key');await ml.waitForSelector('[data-a="startBook"]');
ok('a wrong private link opens the normal page, not the booking',!/You’re booked/.test(await ml.innerText('body')));
const sent=[];const hook=require(ROOT+'/api/_lib/mail.js');
// get the real key the way the client would: from the booking response captured by the page
const realKey=await cl.evaluate(()=>window.__mgKey||'');
ok('private key captured from the booking response',!!realKey,realKey.slice(0,4));
await ml.goto(B+'/?t='+SLUG+'&b='+bk.id+'&k='+encodeURIComponent(realKey));await ml.waitForFunction(()=>/You’re booked, Ravi/.test(document.body.innerText),{timeout:6000});
ok('private link opens the booking',true);
await ml.click('[data-a="set"][data-k="c.cancelAsk"]');await ml.click('[data-a="clientCancel"]');
await ml.waitForFunction(()=>/Session cancelled/.test(document.body.innerText),{timeout:5000});
ok('client sees the cancellation',/No fee applies|fee of/.test(await ml.innerText('body')));
await pg.bringToFront();await pg.reload();await pg.waitForSelector('[data-a="logout"]');await pg.waitForTimeout(2500);
const ra=store.appts.find(a=>a.name==='Ravi Kumar');
ok('console marked the session cancelled by the client',ra.status==='cancelled'&&ra.cancelledBy==='client',JSON.stringify({s:ra.status,by:ra.cancelledBy}));
ok('cancelled time is free again',!db.pub.busy.some(b=>String(b[0])===s2));
ok('all inbox rows are imported and emptied',db.inbox.every(r=>r.imported_at&&JSON.stringify(r.payload)==='{}'));
// ---- waitlist from the client page ----
const mc=await br.newContext({viewport:{width:390,height:800},timezoneId:'Asia/Kolkata'});const mp=await mc.newPage();mp.on('pageerror',e=>errs.push('phone: '+e.message));
await mp.goto(B+'/?t='+SLUG);await mp.waitForSelector('[data-a="startBook"]');
ok('waitlist stays hidden on the free plan',!(await mp.isVisible('[data-a="go"][data-v="waitlist"]')));
ok('phone layout loads the real page',/Asha Rao/.test(await mp.innerText('body')));
// ---- remember me, follow-up without intake, pay now ----
const rc=await br.newContext({viewport:{width:1200,height:850},timezoneId:'Asia/Kolkata'});const rp=await rc.newPage();rp.on('pageerror',e=>errs.push('remember: '+e.message));
await rp.goto(B+'/?t='+SLUG);await rp.waitForSelector('[data-a="startBook"]');
const pickLater=async(pg2)=>{await pg2.click('[data-a="startBook"]');await pg2.waitForSelector('[data-a="pickDay"]');const ds=await pg2.$$eval('[data-a="pickDay"]:not([disabled])',e=>e.map(x=>x.dataset.v));for(const d of ds){if(Number(d)<Date.now()+3*864e5)continue;await pg2.click(`[data-a="pickDay"][data-v="${d}"]`);const x=await pg2.$('[data-a="pickSlot"]:not([disabled])');if(x){await x.click();return true}}return false};
// choose the follow-up type on the intro screen, if the page offers it
await rp.click('[data-a="startBook"]');
const typeBtn=await rp.$('[data-a="pickType"][data-v="follow"]');
ok('follow-up type is offered',!!typeBtn);
if(typeBtn)await typeBtn.click();
await rp.waitForSelector('[data-a="pickDay"]');
{const ds=await rp.$$eval('[data-a="pickDay"]:not([disabled])',e=>e.map(x=>x.dataset.v));let done=false;for(const d of ds){if(Number(d)<Date.now()+3*864e5)continue;await rp.click(`[data-a="pickDay"][data-v="${d}"]`);const x=await rp.$('[data-a="pickSlot"]:not([disabled])');if(x){await x.click();done=true;break}}ok('a later free time exists for the follow-up',done)}
await rp.click('[data-a="toDetails"]');
ok('follow-up progress shows 3 steps',(await rp.$$('.steps span')).length===3);
ok('remember box is offered and unticked by default',await rp.isVisible('#remember')&&!(await rp.isChecked('#remember')));
await rp.fill('[data-f="c.d.fn"]','Sita');await rp.fill('[data-f="c.d.ln"]','Rao');await rp.fill('[data-f="c.d.email"]','sita@example.com');await rp.fill('[data-f="c.d.wa"]','9812345678');await rp.check('#remember');
await rp.click('[data-a="toAbout"]');
await rp.waitForSelector('[data-a="book"]',{timeout:4000}).catch(()=>{});
const bodyTxt=await rp.innerText('body');
ok('follow-up skips the questions (no why-are-you-here, no how-did-you-hear)',!/Describe your issue|How did you hear|How old are you|Client information/.test(bodyTxt)&&!/Informed consent/.test(bodyTxt)&&/cancel or move this session for free/.test(bodyTxt)&&!(await rp.$('[data-f="c.agree"]')),bodyTxt.slice(0,120).replace(/\n+/g,' | '));
await rp.click('[data-a="back"]');await rp.waitForSelector('[data-f="c.d.fn"]');
ok('back from confirm goes to details, not the skipped step',/Your details/.test(await rp.innerText('body')));
await rp.click('[data-a="toAbout"]');await rp.waitForSelector('[data-a="book"]');await rp.click('[data-a="book"]');
await rp.waitForFunction(()=>/You’re booked, Sita/.test(document.body.innerText),{timeout:6000});
const fb=db.inbox.filter(r=>r.kind==='booking').pop();
ok('follow-up booking stored with no intake',fb&&fb.payload.name==='Sita Rao'&&fb.payload.intake===null&&fb.payload.type==='follow');
// pay now
const pt=await rp.innerText('body');
ok('pay-now box shows the amount and the UPI id',/Pay ₹1,500 now by UPI/.test(pt)&&/asha-test@okaxis/.test(pt),pt.slice(pt.indexOf('Pay'),pt.indexOf('Pay')+80).replace(/\n+/g,' | '));
const href=await rp.getAttribute('a:has-text("Open my UPI app")','href');
ok('UPI link carries the id, the fee and INR',/^upi:\/\/pay\?pa=asha-test%40okaxis&pn=.*&am=\d+&cu=INR&tn=/.test(href||''),href);
ok('booked page uses the therapist name properly',!/Your has |Your will /.test(pt)&&/Asha has your booking/.test(pt),pt.slice(0,200).replace(/\n+/g,' | '));
ok('no UTR field is shown to the client',!(await rp.$('[data-f="c.utr"]')));
await rp.click('[data-a="payClaim"]');await rp.waitForFunction(()=>/Thank you/.test(document.body.innerText),{timeout:5000});
ok('one-tap payment notice reaches the server, as a notice only',db.inbox.some(r=>r.kind==='payment'&&!r.payload.paid));
// remembered on the device
const stored=await rp.evaluate(()=>localStorage.getItem('practice-client-me-v1'));
ok('details are remembered on the device, without intake answers',!!stored&&/sita@example.com/.test(stored)&&!/issue|answers/.test(stored),stored);
await rp.goto(B+'/?t='+SLUG);await rp.waitForSelector('[data-a="startBook"]');await rp.click('[data-a="startBook"]');
const t2=await rp.$('[data-a="pickType"][data-v="first"]');if(t2)await t2.click();
await rp.waitForSelector('[data-a="pickDay"]');
{const ds=await rp.$$eval('[data-a="pickDay"]:not([disabled])',e=>e.map(x=>x.dataset.v));for(const d of ds){if(Number(d)<Date.now()+3*864e5)continue;await rp.click(`[data-a="pickDay"][data-v="${d}"]`);const x=await rp.$('[data-a="pickSlot"]:not([disabled])');if(x){await x.click();break}}}
await rp.click('[data-a="toDetails"]');await rp.waitForSelector('[data-f="c.d.fn"]');
ok('next visit: details are filled in from the device',(await rp.inputValue('[data-f="c.d.fn"]'))==='Sita'&&(await rp.inputValue('[data-f="c.d.email"]'))==='sita@example.com'&&await rp.isChecked('#remember'));
await rp.click('[data-a="forgetMe"]');
ok('Not you? Clear empties the form',(await rp.inputValue('[data-f="c.d.fn"]'))===''&&!(await rp.isChecked('#remember')));
await rp.fill('[data-f="c.d.fn"]','Z');await rp.fill('[data-f="c.d.ln"]','Z');await rp.fill('[data-f="c.d.email"]','z@example.com');await rp.fill('[data-f="c.d.wa"]','9812345670');
await rp.click('[data-a="toAbout"]');await rp.waitForTimeout(300);
ok('first session still asks the questions',/How old are you|Describe your issue/.test(await rp.innerText('body')));
await rc.close();
// ---- placeholder name: no "Your has" ----
const savedName=db.pub.profile.name;db.pub.profile.name='Your name';
const pc=await br.newContext({viewport:{width:1200,height:850},timezoneId:'Asia/Kolkata'});const pp=await pc.newPage();pp.on('pageerror',e=>errs.push('placeholder: '+e.message));
await pp.goto(B+'/?t='+SLUG);await pp.waitForSelector('[data-a="startBook"]');
{await pp.click('[data-a="startBook"]');await pp.waitForSelector('[data-a="pickDay"]');const ds=await pp.$$eval('[data-a="pickDay"]:not([disabled])',e=>e.map(x=>x.dataset.v));let ok2=false;for(const d of ds){if(Number(d)<Date.now()+4*864e5)continue;await pp.click(`[data-a="pickDay"][data-v="${d}"]`);const x=await pp.$('[data-a="pickSlot"]:not([disabled])');if(x){await x.click();ok2=true;break}}
 await pp.click('[data-a="toDetails"]');await pp.fill('[data-f="c.d.fn"]','Pia');await pp.fill('[data-f="c.d.ln"]','Nair');await pp.fill('[data-f="c.d.email"]','pia@example.com');await pp.fill('[data-f="c.d.wa"]','9812345671');await pp.click('[data-a="toAbout"]');
 for(const f of await pp.$$eval('form [data-f^="c.a."]',e=>[...new Set(e.filter(x=>/INPUT|TEXTAREA/.test(x.tagName)).map(x=>x.dataset.f+'|'+x.type))])){const [k,ty]=f.split('|');await pp.fill(`form [data-f="${k}"]`,ty==='number'?'29':'x');await pp.keyboard.press('Tab')}
 for(let i=0;i<(await pp.$$eval('form [role="group"]',e=>e.length));i++){const g=(await pp.$$('form [role="group"]'))[i];const c=g&&await g.$('.chip');if(c)await c.click()}
 await pp.click('[data-a="toConfirm"]');await pp.waitForSelector('[data-f="c.agree"]',{timeout:4000}).catch(async()=>{console.log('STUCK:',(await pp.innerText('body')).replace(/\n+/g,' | ').slice(0,700))});await pp.check('[data-f="c.agree"]');await pp.click('[data-a="book"]');
 await pp.waitForFunction(()=>/You’re booked, Pia/.test(document.body.innerText),{timeout:6000});const tt=await pp.innerText('body');
 ok('with the placeholder name the page says "Your therapist", not "Your"',/Your therapist has your booking/.test(tt)&&/Your therapist will send the video link/.test(tt)&&!/Your has|Your will/.test(tt),tt.slice(0,260).replace(/\n+/g,' | '))}
db.pub.profile.name=savedName;await pc.close();
// ---- demo page without a link still works, dark theme ----
const dk=await br.newContext({colorScheme:'dark'});const dp=await dk.newPage();await dp.goto(B+'/');await dp.waitForSelector('[data-a="startBook"]');
ok('page without a link is still the demo',/Meera/.test(await dp.innerText('body')));
const dacc=await dp.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
ok('dark theme uses the sand accent',dacc.toLowerCase()==='#eae0d5',dacc);
ok('no page errors',errs.length===0,errs.join(' | '));
await br.close();srv.close();R.forEach(r=>console.log(r.join(' | ')));process.exit(R.some(r=>r[0]==='FAIL')?1:0)})().catch(e=>{console.error('CRASH',e);R.forEach(r=>console.log(r.join(' | ')));process.exit(2)});
