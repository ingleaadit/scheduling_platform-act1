// Browser test. Run with: node tests/e2e/update.e2e.js (or all of them: npm run test:e2e). Prints PASS/FAIL lines.
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const root=require('path').resolve(__dirname,'..','..');let ver=null,loads=0;
const srv=http.createServer((q,r)=>{let u=q.url.split('?')[0];if(u==='/')u='/index.html';if(u==='/version.json'&&ver){r.setHeader('content-type','application/json');return r.end(JSON.stringify({v:ver}))}
 const f=path.join(root,u);if(!fs.existsSync(f)){r.statusCode=404;return r.end()}if(u==='/index.html')loads++;r.setHeader('content-type',u.endsWith('.js')?'text/javascript':u.endsWith('.css')?'text/css':u.endsWith('.json')?'application/json':'text/html');r.end(fs.readFileSync(f))}).listen(0,async()=>{
 const B='http://localhost:'+srv.address().port;const br=await chromium.launch();const pg=await br.newPage();await pg.goto(B+'/');await pg.waitForSelector('[data-a="startBook"]');
 const ok=(n,c)=>console.log((c?'PASS':'FAIL')+' | '+n);
 ok('page carries a build id',/^[0-9a-f]{10}$/.test(await pg.evaluate(()=>window.APP_V)));
 await pg.evaluate(()=>window.__chkVersion());await pg.waitForTimeout(500);ok('same version: no reload',loads===1);
 ver='different01';await pg.evaluate(()=>window.__chkVersion());await pg.waitForSelector('[data-a="startBook"]');await pg.waitForTimeout(500);ok('newer version on the intro screen: page reloads by itself',loads===2);
 await pg.click('[data-a="startBook"][data-v="first"]');await pg.waitForSelector('[data-a="pickDay"]');await pg.evaluate(()=>window.__chkVersion());await pg.waitForTimeout(600);
 ok('mid-booking: no reload, bar shown instead',loads===2&&!!(await pg.$('#updbar')));
 await br.close();srv.close()});
