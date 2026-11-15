// Browser test. Run with: node tests/e2e/login.e2e.js (or all of them: npm run test:e2e). Prints PASS/FAIL lines.
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=require('path').resolve(__dirname,'..','..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((req,res)=>{let u=req.url.split('?')[0].split('#')[0];if(u==='/')u='/index.html';if(u==='/console')u='/console.html';
  const f=path.join(ROOT,u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.statusCode=404;return res.end('nf')}
  res.setHeader('content-type',types[path.extname(f)]||'text/plain');res.end(fs.readFileSync(f))});
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=()=>`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:'24ad3bf8-e9b0-4686-876c-b32e0a1bc7d4',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}.sig`;
const user={id:'24ad3bf8-e9b0-4686-876c-b32e0a1bc7d4',aud:'authenticated',role:'authenticated',email:'t@example.com',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const sess=()=>({access_token:jwt(),token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'r',user});
let results=[];const ok=(n,c,x='')=>{results.push([c?'PASS':'FAIL',n,x]);};
(async()=>{
  await new Promise(r=>srv.listen(8765,r));
  const br=await chromium.launch();
  const mk=async()=>{const ctx=await br.newContext({viewport:{width:1100,height:800}});const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
    let calls={pw:0,put:0};
    await pg.route('**/auth/v1/token?grant_type=password',async r=>{calls.pw++;const body=JSON.parse(r.request().postData()||'{}');
      if(body.password==='Correct-Horse-9')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(sess())});
      r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'invalid_grant',error_description:'Invalid login credentials',code:'invalid_credentials'})})});
    await pg.route('**/auth/v1/user',async r=>{if(r.request().method()==='PUT'){calls.put++;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)})}r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)})});
    await pg.route('**/auth/v1/logout*',r=>r.fulfill({status:204,body:''}));
    await pg.route('**/rest/v1/practice_public*',r=>r.fulfill({status:201,body:''}));await pg.route('**/rest/v1/booking_inbox*',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));await pg.route('**/rest/v1/practice_data*',r=>r.fulfill({status:r.request().method()==='POST'?201:200,contentType:'application/json',body:r.request().method()==='POST'?'':'[]'}));
    return {ctx,pg,errs,calls}};

  // 1. console shows real sign-in
  let {ctx,pg,errs,calls}=await mk();
  await pg.goto('http://localhost:8765/console');await pg.waitForSelector('form[data-form="login"]');ok('real sign-in offers the demo',/href="demo"/.test(await pg.content()));
  let txt=await pg.innerText('body');
  ok('console shows Sign in',/Sign in/.test(txt));
  ok('no demo login box',!/Demo login/.test(txt)&&!/Practice2026/.test(txt));
  ok('no social provider buttons',!/Continue with Google/.test(txt));
  ok('no phone option',!/Use phone number instead/.test(txt));
  ok('no create-account link',!/Create an account/.test(txt)&&/invitation only/.test(txt));
  // demo credentials must NOT work
  await pg.fill('#le','demo@practice.test');await pg.fill('#lp','Practice2026');await pg.click('form[data-form="login"] button[type=submit]');
  await pg.waitForSelector('.err');
  ok('demo credentials rejected by real login',/don’t match/.test(await pg.innerText('.err'))&&calls.pw===1);
  ok('still on sign-in after wrong password',await pg.isVisible('form[data-form="login"]'));
  // right password
  await pg.fill('#lp','Correct-Horse-9');await pg.fill('#le','t@example.com');await pg.click('form[data-form="login"] button[type=submit]');
  await pg.waitForSelector('form[data-form="login"]',{state:'detached',timeout:5000});await pg.waitForSelector('[data-a="logout"]',{timeout:5000}).catch(()=>{});await pg.waitForTimeout(700);await pg.evaluate(()=>{const b=document.querySelector('[data-a="tourSkip"]');if(b)b.click()});
  txt=await pg.innerText('body');
  ok('correct password opens the console',/Log out/.test(txt)&&/Today/.test(txt)&&!(await pg.$('form[data-form="login"]')));
  // reload keeps session
  await pg.reload();await pg.waitForTimeout(800);
  ok('session survives reload',!(await pg.$('form[data-form="login"]')));await pg.waitForTimeout(500);await pg.evaluate(()=>{const b=document.querySelector('[data-a="tourSkip"]');if(b)b.click()});
  // sign out
  const lo=await pg.$('[data-a="logout"]');if(lo){await pg.click('[data-a="logout"]');await pg.waitForSelector('form[data-form="login"]',{timeout:4000});ok('log out returns to sign-in',true)}else ok('log out button found',false);
  await pg.waitForFunction(()=>!Object.keys(localStorage).some(k=>/auth-token/.test(k)),null,{timeout:5000}).catch(()=>{});await pg.reload();await pg.waitForSelector('form[data-form="login"]');ok('stays signed out after reload',true);
  ok('no page errors (console)',errs.length===0,errs.join('|'));
  await ctx.close();

  // 2. invite link on the client page redirects to the console and asks for a password
  ({ctx,pg,errs,calls}=await mk());
  const hash=`#access_token=${jwt()}&expires_in=3600&refresh_token=r&token_type=bearer&type=invite`;
  await pg.goto('http://localhost:8765/'+hash);await pg.waitForURL(/\/console/,{timeout:5000});
  ok('invite link on client page redirects to /console',/\/console/.test(pg.url()));
  await pg.waitForSelector('form[data-form="login"]');txt=await pg.innerText('body');
  ok('invite shows Set your password',/Set your password/.test(txt),txt.slice(0,120).replace(/\n/g,' '));
  await pg.fill('#lp','short');await pg.fill('#lp2','short');await pg.click('form[data-form="login"] button[type=submit]');
  ok('short password rejected',/at least 10/.test(await pg.innerText('.err'))&&calls.put===0);
  await pg.fill('#lp','Correct-Horse-9');await pg.fill('#lp2','different-pass-1');await pg.click('form[data-form="login"] button[type=submit]');
  ok('mismatch rejected',/don’t match/.test(await pg.innerText('.err'))&&calls.put===0);
  await pg.fill('#lp2','Correct-Horse-9');await pg.click('form[data-form="login"] button[type=submit]');
  await pg.waitForSelector('form[data-form="login"]',{state:'detached',timeout:5000});
  await pg.waitForSelector('[data-a="logout"]',{timeout:5000});await pg.waitForTimeout(700);await pg.evaluate(()=>{const b=document.querySelector('[data-a="tourSkip"]');if(b)b.click()});
  ok('setting a valid password signs in',calls.put===1&&/Log out/.test(await pg.innerText('body')));
  ok('no page errors (invite)',errs.length===0,errs.join('|'));
  await ctx.close();

  // 3. client page is public and unaffected
  ({ctx,pg,errs}=await mk());
  await pg.goto('http://localhost:8765/');await pg.waitForTimeout(800);txt=await pg.innerText('body');
  ok('client page loads without sign-in',/Book a session/.test(txt)&&!(await pg.$('form[data-form="login"]')));
  ok('no page errors (client)',errs.length===0,errs.join('|'));
  await ctx.close();

  // 4. offline prototype (no Supabase) keeps its demo login
  ({ctx,pg,errs}=await mk());
  await pg.goto('file://'+ROOT+'/src/prototype.html#therapist-desktop');await pg.waitForSelector('form[data-form="login"]');
  txt=await pg.innerText('body');
  ok('prototype still shows demo login box',/Demo login/.test(txt)&&/Continue with Google/.test(txt));
  await pg.click('[data-a="fillDemo"]');await pg.click('form[data-form="login"] button[type=submit]');
  await pg.waitForSelector('form[data-form="login"]',{state:'detached',timeout:5000});
  ok('prototype demo login still works',/Log out/.test(await pg.innerText('body')));
  ok('no page errors (prototype)',errs.length===0,errs.join('|'));
  await ctx.close();

  await br.close();srv.close();
  results.forEach(r=>console.log(r.join(' | ')));
  process.exit(results.some(r=>r[0]==='FAIL')?1:0);
})().catch(e=>{console.error('TEST CRASH',e);process.exit(2)});
