// Browser test. Run with: node tests/e2e/find.e2e.js (or all of them: npm run test:e2e). Prints PASS/FAIL lines.
const ROOT=require('path').resolve(__dirname,'..','..');
const { chromium } = require('playwright');
const R=[];const ok=(n,c,x)=>R.push([c?'PASS':'FAIL',n,x||''].join(' | '));
(async()=>{const br=await chromium.launch();const pg=await (await br.newContext({viewport:{width:1200,height:850}})).newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
 await pg.goto('file://'+ROOT+'/src/prototype.html#therapist-desktop');await pg.waitForSelector('form[data-form="login"]');
 await pg.click('[data-a="fillDemo"]');await pg.click('form[data-form="login"] button[type=submit]');await pg.waitForSelector('form[data-form="login"]',{state:'detached'});await pg.waitForTimeout(400);
 ok('top search box is gone',!(await pg.$('#topq')));
 ok('one search bar remains',(await pg.$$('.findbtn')).length===1);
 await pg.click('.findbtn');await pg.waitForSelector('#findq');await pg.fill('#findq','Vikram');await pg.waitForTimeout(150);
 let t=await pg.innerText('#findres');ok('finds a client with Book',/Vikram Joshi/.test(t)&&/Book/.test(t));
 await pg.fill('#findq','payment');await pg.waitForTimeout(150);t=await pg.innerText('#findres');ok('finds actions too',/Record a payment/.test(t));
 ok('no page errors',errs.length===0,errs.join('|'));await br.close();console.log(R.join('\n'))})();
