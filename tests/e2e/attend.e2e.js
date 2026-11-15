// Browser test. Run with: node tests/e2e/attend.e2e.js (or all of them: npm run test:e2e). Prints PASS/FAIL lines.
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
(async()=>{await new Promise(r=>srv.listen(8771,r));const br=await chromium.launch();
const ctx=await br.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Kolkata',colorScheme:'light'});const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
await pg.route('**/auth/v1/token?grant_type=password',r=>J(r,200,sess()));
await pg.route('**/auth/v1/user',r=>J(r,200,user));
await pg.route('**/rest/v1/practice_data*',r=>{const m=r.request().method();if(m==='GET')return J(r,200,store?[{data:store}]:[]);const b=JSON.parse(r.request().postData());store=(Array.isArray(b)?b[0]:b).data;r.fulfill({status:201,body:''})});
await pg.route('**/rest/v1/practice_public*',r=>{const b=JSON.parse(r.request().postData());const row=Array.isArray(b)?b[0]:b;db.pub=row.data;pubSlug=row.slug;r.fulfill({status:201,body:''})});
await pg.route('**/rest/v1/booking_inbox*',r=>{const m=r.request().method();
  if(m==='GET')return J(r,200,db.inbox.filter(x=>!x.imported_at).map(x=>({id:x.id,kind:x.kind,payload:x.payload})));
  if(m==='PATCH'){const b=JSON.parse(r.request().postData());const ids=(/id=in\.\(([^)]*)\)/.exec(decodeURIComponent(r.request().url()))||[,''])[1].split(',').map(s=>s.replace(/"/g,''));patches.push({b,ids});db.inbox.forEach(x=>{if(ids.includes(x.id)){x.imported_at=b.imported_at;x.payload=b.payload}});return r.fulfill({status:204,body:''})}
  r.fulfill({status:200,body:'[]'})});
const B='http://localhost:8771';
const DAY=864e5;
function nextMonday11(){let t=Date.now()+DAY;for(;;){const d=new Date(t+330*60000);if(d.getUTCDay()===1){d.setUTCHours(11,0,0,0);return d.getTime()-330*60000}t+=DAY}}
db.pub={profile:{name:'Asha Rao',where:'Online'},types:[{id:'first',name:'First session',min:60,fee:1500},{id:'follow',name:'Follow-up session',min:50,fee:1500}],hours:{0:[],1:[['10:00','13:00']],2:[],3:[],4:[],5:[],6:[]},blocks:[],intake:[],consent:'',settings:{cancelWindow:24,latePct:50,room:'meet.example/room',upi:''},busy:[],tzOff:-330};
const mk=async(email,start,far)=>{const r=await fetch(B+'/api/book',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({t:SLUG,kind:'booking',fn:'Ravi',ln:'Kumar',email,wa:'9876543210',type:'follow',start,mode:'Online',answers:{}})}).then(r=>r.json());
  const row=db.inbox.find(x=>x.id===r.manage.b);if(far)return r.manage;row.starts_at=new Date(Date.now()+20*60000).toISOString();row.ends_at=new Date(Date.now()+70*60000).toISOString();row.payload.start=Date.now()+20*60000;return r.manage};
const m1=await mk('a@example.com',nextMonday11()),m2=await mk('b@example.com',nextMonday11()+DAY*0+36e5*1.01),m3=await mk('c@example.com',nextMonday11()+DAY*7,true);
for(const [m,ans,txt] of [[m1,'yes',/knows you will be there/],[m2,'no',/has been told you can.t make it/]]){
  const p=await ctx.newPage();await p.goto(`${B}/?t=${SLUG}&b=${m.b}&k=${m.k}&a=${ans}`);
  await p.waitForFunction(re=>re.test(document.body.innerText),txt,{timeout:8000}).catch(()=>{});
  const t1=await p.innerText('body');ok(`one tap, link a=${ans}: recorded on arrival, no second tap`,txt.test(t1)&&!(await p.$('[data-a="attend"]')),t1.slice(0,200).replace(/\n+/g,' | '));
  ok(`answer ${ans}: stored for the therapist`,db.inbox.some(x=>x.kind==='attend'&&x.payload.answer===ans&&x.payload.apptId==='b'+m.b));
  if(ans==='no')ok('late session: no Reschedule button offered',!(await p.$('[data-a="resched"]')));
  await p.close()}
// Reschedule button, session far enough away: opens the time picker straight away, tells nobody yet
{const p=await ctx.newPage();await p.goto(`${B}/?t=${SLUG}&b=${m3.b}&k=${m3.k}&a=no`);await p.waitForTimeout(2500);const t=await p.innerText('body');
 ok('Reschedule link: opens the time picker',/Pick a|Choose a|time|day/i.test(t)&&!/You’re booked/.test(t),t.slice(0,120).replace(/\n+/g,' | '));
 ok('Reschedule link: nothing recorded until they pick a time',!db.inbox.some(x=>x.kind==='attend'&&x.payload.apptId==='b'+m3.b));await p.close()}
// no question without the reminder link
const p0=await ctx.newPage();await p0.goto(`${B}/?t=${SLUG}&b=${m1.b}&k=${m1.k}`);await p0.waitForSelector('h1');ok('plain manage link shows no question',!/Will you be there at/.test(await p0.innerText('body')));await p0.close();
// the therapist console picks the replies up
const ca=pg;await ca.goto(B+'/console');await ca.waitForSelector('form[data-form="login"]');await ca.fill('#le','t@example.com');await ca.fill('#lp','x');await ca.click('form[data-form="login"] button[type=submit]');await ca.waitForSelector('.tabbar');await ca.waitForTimeout(2500);await ca.waitForTimeout(700);await ca.evaluate(()=>{const b=document.querySelector('[data-a="tourSkip"]');if(b)b.click()});
await ca.click('[data-a="tab"][data-v="notifs"]');await ca.waitForTimeout(500);const nt=await ca.innerText('body');
ok('console shows the reply in notifications',/Will attend|Can.t make it/.test(nt),nt.slice(0,300).replace(/\n+/g,' | '));
console.log(R.map(r=>r.join(' | ')).join('\n'));console.log('errors',errs);await br.close();srv.close();})();
