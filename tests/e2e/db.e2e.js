// Browser test. Run with: node tests/e2e/db.e2e.js (or all of them: npm run test:e2e). Prints PASS/FAIL lines.
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT=require('path').resolve(__dirname,'..','..');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((req,res)=>{let u=req.url.split('?')[0].split('#')[0];if(u==='/')u='/index.html';if(u==='/console')u='/console.html';const f=path.join(ROOT,u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.statusCode=404;return res.end('nf')}res.setHeader('content-type',types[path.extname(f)]||'text/plain');res.end(fs.readFileSync(f))});
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=()=>`${b64({alg:'HS256'})}.${b64({sub:'u1',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}.s`;
const user={id:'24ad3bf8-e9b0-4686-876c-b32e0a1bc7d4',aud:'authenticated',role:'authenticated',email:'t@example.com',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const sess=()=>({access_token:jwt(),token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'r',user});
const R=[];const ok=(n,c,x='')=>R.push([c?'PASS':'FAIL',n,x]);
let store=null,posts=0,failGet=false,failPost=false;
(async()=>{await new Promise(r=>srv.listen(8768,r));const br=await chromium.launch();
const ctx=await br.newContext({viewport:{width:1200,height:800}});const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
await pg.route('**/auth/v1/token?grant_type=password',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(sess())}));
await pg.route('**/auth/v1/user',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)}));
await pg.route('**/auth/v1/logout*',r=>r.fulfill({status:204,body:''}));
await pg.route('**/rest/v1/practice_public*',r=>failPost?r.fulfill({status:500,contentType:'application/json',body:'{"message":"boom"}'}):r.fulfill({status:201,body:''}));await pg.route('**/rest/v1/booking_inbox*',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));await pg.route('**/rest/v1/practice_data*',async r=>{const m=r.request().method();
  if(m==='GET'){if(failGet)return r.fulfill({status:500,contentType:'application/json',body:'{"message":"boom"}'});return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(store?[{data:store}]:[])})}
  if(m==='POST'){if(failPost)return r.fulfill({status:500,contentType:'application/json',body:'{"message":"boom"}'});posts++;const b=JSON.parse(r.request().postData());store=(Array.isArray(b)?b[0]:b).data;return r.fulfill({status:201,body:''})}
  r.fulfill({status:200,body:'[]'})});
const signIn=async()=>{await pg.waitForSelector('form[data-form="login"]');await pg.fill('#le','t@example.com');await pg.fill('#lp','x');await pg.click('form[data-form="login"] button[type=submit]');await pg.waitForSelector('[data-a="logout"]',{timeout:6000});await pg.waitForTimeout(700);await pg.evaluate(()=>{const b=document.querySelector('[data-a="tourSkip"]');if(b)b.click()});};

// 1. blank start
await pg.goto('http://localhost:8768/console');await signIn();
let txt=await pg.innerText('body');
ok('new account starts blank (no demo clients)',!/Meera|Aisha|Arjun|Nikhil|Sana Verma/.test(txt),txt.slice(0,160).replace(/\n+/g,' | '));
ok('demo bar and reset hidden',!(await pg.isVisible('#livebar'))&&!(await pg.isVisible('#livereset')));
// walk every tab for errors
for(const place of ['People','Settings','Today']){const b=await pg.$(`button:has-text("${place}")`);if(b)await b.click().catch(()=>{});
  const tabs=await pg.$$eval('[data-a="tab"]',els=>[...new Set(els.map(e=>e.dataset.v))]);
  for(const t of tabs){const el=await pg.$(`[data-a="tab"][data-v="${t}"]`);if(el)await el.click().catch(()=>{});await pg.waitForTimeout(60)}}
ok('every tab opens without a page error',errs.length===0,errs.slice(0,3).join(' | '));
// 2. edit saves to the database, not the browser
const pb=await pg.$('button:has-text("Settings")');if(pb)await pb.click();
const prof=await pg.$('[data-a="tab"][data-v="profile"]');if(prof)await prof.click();
await pg.waitForSelector('[data-f="data.profile.name"]',{timeout:4000});
await pg.fill('[data-f="data.profile.name"]','Dr Test Person');
await pg.waitForTimeout(2000);
ok('edit is saved to the database',posts>=1&&store&&store.profile&&store.profile.name==='Dr Test Person',`posts=${posts}`);
ok('nothing stored in browser storage',await pg.evaluate(()=>localStorage.getItem('practice-proto-v1')===null));
// 3. reload keeps the session and the data
await pg.reload();await pg.waitForSelector('[data-a="logout"]',{timeout:6000});
ok('data comes back after reload',/Dr Test Person/.test(await pg.innerText('body')));
// 4. logout wipes memory, next account is separate
await pg.click('[data-a="logout"]');await pg.waitForSelector('form[data-form="login"]');
store=null;
await pg.fill('#le','other@example.com');await pg.fill('#lp','x');await pg.click('form[data-form="login"] button[type=submit]');await pg.waitForSelector('[data-a="logout"]',{timeout:6000});await pg.waitForTimeout(700);await pg.evaluate(()=>{const b=document.querySelector('[data-a="tourSkip"]');if(b)b.click()});
ok('a different account does not see the first account’s data',!/Dr Test Person/.test(await pg.innerText('body')));
// 5. load failure blocks the app and does not overwrite
const before=posts;failGet=true;store={appts:[],profile:{name:'Existing Data'},types:[],hours:{},settings:{},intake:[],waitlist:[],supervision:[],blocks:[],clients:[],checked:{}};
await pg.reload();await pg.waitForSelector('[data-a="sbretry"]',{timeout:6000});
ok('load failure shows an error and retry',/could not load/.test(await pg.innerText('body')));
await pg.waitForTimeout(1800);
ok('failed load never writes blank data over real data',posts===before&&store.profile.name==='Existing Data');
failGet=false;await pg.click('[data-a="sbretry"]');await pg.waitForSelector('[data-a="logout"]',{timeout:6000});
ok('retry loads the saved data',/Existing Data/.test(await pg.innerText('body')));
// 6. failed save is reported
failPost=true;const pb2=await pg.$('button:has-text("Settings")');if(pb2)await pb2.click();const p2=await pg.$('[data-a="tab"][data-v="profile"]');if(p2)await p2.click();
await pg.fill('[data-f="data.profile.name"]','Changed');await pg.waitForTimeout(2000);
ok('failed save tells the user',/Could not save/.test(await pg.innerText('#toast')||''));
ok('no page errors overall',errs.length===0,errs.join(' | '));
await br.close();srv.close();R.forEach(r=>console.log(r.join(' | ')));process.exit(R.some(r=>r[0]==='FAIL')?1:0)})().catch(e=>{console.error('CRASH',e);process.exit(2)});
