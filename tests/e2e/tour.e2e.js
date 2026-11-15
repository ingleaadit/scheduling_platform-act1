// Browser test. Run with: node tests/e2e/tour.e2e.js (or all of them: npm run test:e2e). Prints PASS/FAIL lines.
const ROOT=require('path').resolve(__dirname,'..','..');
const { chromium } = require('playwright');
const SD=require('os').tmpdir()+'/';
const R=[];const ok=(n,c,x)=>R.push([c?'PASS':'FAIL',n,x||''].join(' | '));
(async()=>{const br=await chromium.launch();
 for(const [label,vp,hash] of [['desktop',{width:1200,height:850},'#therapist-desktop'],['phone',{width:390,height:844},'#therapist-phone']]){
  const ctx=await br.newContext({viewport:vp,deviceScaleFactor:1});const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto('file://'+ROOT+'/src/prototype.html'+hash);await pg.waitForSelector('form[data-form="login"]');
  await pg.click('[data-a="fillDemo"]');await pg.click('form[data-form="login"] button[type=submit]');await pg.waitForSelector('form[data-form="login"]',{state:'detached'});
  // open Settings, replay the tutorial
  await pg.evaluate(()=>{});
  const more=await pg.$('[data-a="tab"][data-v="more"]');if(more)await more.click();
  const rep=await pg.$('[data-a="tourReplay"]');ok(label+': "Take the tutorial again" is in Settings',!!rep);if(!rep){console.log(R.join('\n'));continue}
  await rep.click();await pg.waitForSelector('[aria-label="Getting started"]');
  const T=async()=>await pg.innerText('[aria-label="Getting started"]');
  let t=await T();ok(label+': welcome step',/Step 1 of 8/.test(t)&&/Today/.test(t),t.slice(0,60).replace(/\n+/g,' | '));await pg.screenshot({path:SD+`tour_${label}_1.png`});
  await pg.click('[data-a="tourNext"]');t=await T();ok(label+': about you',/About you/.test(t));
  // name required
  await pg.fill('#tnm','');await pg.click('[data-a="tourNext"]');t=await T();ok(label+': name is required',/Enter your name/.test(t)&&/About you/.test(t));
  await pg.fill('#tnm','Asha Rao');await pg.click('[data-a="tourNext"]');t=await T();ok(label+': fees step asks the questions',/What do you charge for a first session/.test(t)&&/sliding scale/.test(t)&&/Your lowest fee/.test(t),t.replace(/\n+/g,' | ').slice(0,200));await pg.screenshot({path:SD+`tour_${label}_fees.png`});
  await pg.fill('#tfreduced','600');await pg.fill('#tffirst','2000');
  await pg.click('[data-a="set"][data-k="modal.sliding"][data-v="No"]');t=await T();ok(label+': No hides the reduced fee',!/Your lowest fee/.test(t)&&/Only first and follow-up/.test(t));
  await pg.click('[data-a="set"][data-k="modal.sliding"][data-v="Yes"]');t=await T();ok(label+': Yes brings it back',/Your lowest fee/.test(t));
  await pg.click('[data-a="set"][data-k="modal.sliding"][data-v="No"]');
  await pg.click('[data-a="tourNext"]');t=await T();ok(label+': rules step',/Cancellations and payment/.test(t));
  for(const exp of ['Reminders and video','Your working hours','Your booking page','You are set']){await pg.click('[data-a="tourNext"]');t=await T();ok(label+': '+exp,t.includes(exp))}
  await pg.screenshot({path:SD+`tour_${label}_done.png`});
  await pg.click('[data-a="tourNext"]');await pg.waitForTimeout(300);ok(label+': Finish closes the tour',!(await pg.$('[aria-label="Getting started"]')));
  const st=await pg.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>/practice|proto/i.test(k))||'')||'null'));
  const d=st&&st.data;ok(label+': choices were saved',!!d&&d.profile.name==='Asha Rao'&&d.types.find(x=>x.id==='first').fee===2000&&!d.types.some(x=>x.id==='reduced')&&!!d.tourDone,d?JSON.stringify({n:d.profile.name,types:d.types.map(x=>x.id+':'+x.fee),done:!!d.tourDone}):'no state');
  ok(label+': no page errors',errs.length===0,errs.join('|'));await ctx.close()}
 console.log(R.join('\n'));await br.close()})();
