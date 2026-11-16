// Browser e2e: two players online (password, lobby, reconnect, chat, emoji, resign) + shake-to-roll on a phone.
// PREVIEW_ONLY=1: current online 360x780 hints/undo screenshots in all themes.
// Usage: npm run build && (cd worker && npx wrangler dev) & node e2e/online.e2e.cjs [screenshot-dir]
const { chromium, devices } = require('playwright');
const OUT = process.argv[2] || 'e2e-shots';
require('fs').mkdirSync(OUT, { recursive: true });
const IMPL_SCREEN_DIR = process.env.IMPL_SCREEN_DIR || 'docs/design/impl-screens';
const BASE = process.env.NARDY_URL || 'http://127.0.0.1:8787';
const settings = (name) => JSON.stringify({ state: { name, lang: 'ru', theme: 'wood', sound: false, speed: 'fast', autoRoll: false, autoConfirm: true, hints: true, shake: true, vibration: false }, version: 1 });
const errors = [];
async function mk(b, name, opts = { viewport: { width: 1100, height: 900 } }) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(name + ': ' + e + '\n' + (e.stack||'').split('\n').slice(0,6).join('\n')));
  p.on('console', (m) => {
    if (m.type() !== 'error' || m.text().includes('vibrate')) return;
    // A guest without a cookie is an expected unauthenticated profile read.
    if (m.text().includes('401 (Unauthorized)') && m.location().url === BASE + '/api/profile') return;
    errors.push(name + ' console: ' + m.text());
  });
  await p.goto(BASE + '/');
  await p.evaluate((s) => localStorage.setItem('nardy.settings', s), settings(name));
  return p;
}
async function playTurn(p) {
  const roll = p.locator('button:has-text("Бросить")');
  if (await roll.count()) { await roll.click(); await p.waitForTimeout(700); }
  for (let k = 0; k < 14; k++) {
    const t = p.locator('[data-hint="target"] circle').first();
    if (await t.count()) {
      const bb = await t.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(350); continue;
    }
    const tray = p.locator('[data-hint="target-off"] rect').first();
    if (await tray.count()) { const bb = await tray.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(350); continue; }
    const ring = p.locator('[data-hint="movable"]').first();
    if (await ring.count()) { const bb = await ring.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(200); continue; }
    break;
  }
  await p.waitForTimeout(500);
}
async function tap(p, loc) {
  const bb = await loc.first().boundingBox();
  if (!bb) throw new Error('missing move hit box');
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
}
async function finishPending(p) {
  let before;
  for (let i = 0; i < 30; i++) {
    if (await p.locator('button.undo-send').count()) return before;
    before = await p.locator('[data-pips="me"]').textContent();
    const target = p.locator('[data-hint="target"] circle').first();
    const off = p.locator('[data-hint="target-off"] rect').first();
    const ring = p.locator('[data-hint="movable"]').first();
    if (await target.count()) await tap(p, target);
    else if (await off.count()) await tap(p, off);
    else if (await ring.count()) await tap(p, ring);
    await p.waitForTimeout(100);
  }
  throw new Error('undo window missing after completing turn: ' + await p.locator('.action-bar, .controls').first().innerText());
}
async function autoFlow(b) {
  const p = await mk(b, 'M2');
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('nardy.settings'));
    Object.assign(s.state, {autoRoll:true, autoConfirm:true, speed:'instant'});
    localStorage.setItem('nardy.settings', JSON.stringify(s));
  });
  await p.goto(BASE + '/play?mode=ai&level=beginner');
  await p.waitForSelector('.status:has-text("Ваш ход")', {timeout:15000});
  await p.waitForFunction(() => document.querySelectorAll('.dice-tray:not(.single) .die-wrap').length === 2, null, {timeout:1500});
  console.log('M2 auto-roll dice = 2');
  const before = await finishPending(p);
  await p.locator('button.undo-send').click();
  await p.locator('button.undo-send').waitFor({state:'hidden'});
  const after = await p.locator('[data-pips="me"]').textContent();
  if (before !== after) throw new Error(`undo last fragment: before ${before}, after ${after}`);
  console.log('M2 undo restored pips:', after);
  await finishPending(p);
  await p.waitForFunction(() => !document.querySelector('.status')?.textContent.includes('Ваш ход'), null, {timeout:1600});
  console.log('M2 auto-send changed turn within 1600ms');
  await p.context().close();
}

async function recovery(b, mode) {
  const a = await mk(b, 'Recovery A');
  const p = await mk(b, 'Recovery B');
  for (const page of [a,p]) await page.evaluate(() => {
    const s=JSON.parse(localStorage.getItem('nardy.settings')); s.state.speed='instant'; localStorage.setItem('nardy.settings',JSON.stringify(s));
  });
  let armed=false, frames=0, seq=-1, initialSeq;
  await a.routeWebSocket(/\/ws$/, ws => {
    const srv=ws.connectToServer();
    srv.onMessage(raw=>{const m=JSON.parse(String(raw)); if(m.t==='state'&&m.match)seq=m.match.seq; ws.send(raw);});
    ws.onMessage(raw=>{
      const m=JSON.parse(String(raw));
      if(m.t==='move') {
        frames++;
        if(armed) {
          armed=false;
          if(mode==='drop') {ws.close();return;}
          m.steps[0].from=-99; srv.send(JSON.stringify(m));return;
        }
      }
      srv.send(raw);
    });
  });
  const response=await fetch(BASE+'/api/rooms',{method:'POST',body:JSON.stringify({settings:{variant:'long',isPublic:false,moveTimer:0,bank:0}})});
  const {id}=await response.json();
  await a.goto(BASE+'/r/'+id); await p.goto(BASE+'/r/'+id);
  await a.waitForSelector('.board-svg'); await p.waitForSelector('.board-svg');
  if(!await a.locator('.status:has-text("Ваш ход")').count()) {
    await playTurn(p); await a.waitForSelector('.status:has-text("Ваш ход")');
  }
  const roll=a.locator('button:has-text("Бросить")');
  if(await roll.count()) await roll.click();
  await a.waitForSelector('.dice-tray:not(.single) .die-wrap');
  initialSeq=seq; armed=true;
  await finishPending(a);
  if(mode==='reject') {
    await a.locator('button:has-text("Готово"):enabled').waitFor({timeout:3000});
    await a.waitForTimeout(1500);
    if(frames!==1)throw new Error('rejected move auto-resent: frames='+frames);
    await a.locator('button:has-text("Готово")').click();
  } else {
    const deadline=Date.now()+15000; let recovered=false;
    while(Date.now()<deadline && seq<=initialSeq) {
      if(await a.locator('button.undo-send, button:has-text("Готово"):enabled').count())recovered=true;
      await a.waitForTimeout(50);
    }
    if(!recovered || seq<=initialSeq)throw new Error('stuck: seq='+seq+' initial='+initialSeq+' controls='+await a.locator('.action-bar, .controls').first().innerText());
  }
  const deadline=Date.now()+3000;
  while(seq<=initialSeq && Date.now()<deadline)await a.waitForTimeout(50);
  if(seq<=initialSeq)throw new Error(mode+' move did not complete: seq '+seq);
  console.log(`${mode} recovery: seq ${initialSeq} -> ${seq}, move frames ${frames}`);
  await a.context().close();await p.context().close();
}

async function rejoinScenario(b) {
  const a=await mk(b,'Алиса'), old=await mk(b,'Борис');
  const r=await fetch(BASE+'/api/rooms',{method:'POST',body:JSON.stringify({settings:{variant:'short',isPublic:false,moveTimer:0,bank:0},password:'42'})});
  const {id}=await r.json(),url=BASE+'/r/'+id;
  for(const p of [a,old]){await p.goto(url);await p.locator('input[type=password]').fill('42');await p.locator('button:has-text("Войти")').click();}
  await old.waitForSelector('.board-svg');
  const ownerContext=old.context(); await old.close(); await a.waitForTimeout(400);
  const visitor=await mk(b,'Eve'); await visitor.goto(url);
  await visitor.getByText('Комната заполнена',{exact:true}).waitFor();
  if(await visitor.locator('input[type=password]').count())throw Error('occupied room prompted visitor for password');
  const c=await ownerContext.newPage(); await c.goto(url); await c.waitForSelector('.board-svg');
  await c.reload(); await c.waitForSelector('.board-svg');
  console.log('rejoin: visitor denied; saved token restores owner after tab close and reload');
  for(const p of [a,c,visitor])await p.context().close();
}

async function verifyLayouts() {
  const fs=require('fs');
const b=await chromium.launch({channel:'chrome'});let errors=[];let count=0;
for(const [width,height] of [[360,780],[768,1024],[1440,900]])for(const theme of ['wood','minimal','malachite','night']){
 const ctx=await b.newContext({viewport:{width,height},isMobile:width===360,hasTouch:width===360});
 await ctx.addInitScript(({theme})=>localStorage.setItem('nardy.settings',JSON.stringify({version:1,state:{name:'QA',lang:'ru',theme,sound:false,speed:'instant',autoRoll:true,autoConfirm:true,hints:true,shake:true,vibration:false}})),{theme});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await p.goto('http://127.0.0.1:8787/play?mode=ai&variant=long&level=beginner');
 await p.waitForSelector('.status:has-text("Ваш ход")');await p.waitForSelector('.dice-tray:not(.single) .die-wrap');await p.waitForTimeout(150);
 const values=await p.evaluate(()=>{
 const svg=document.querySelector('.board-svg'),r=svg.getBoundingClientRect();
 let f=svg[Object.keys(svg).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.movable)f=f.return;
 const props=f?.memoizedProps;
 const offenders=[...document.querySelectorAll('g.ck')].filter(c=>{const q=c.getBoundingClientRect();return q.left<r.left-.1||q.right>r.right+.1||q.top<r.top-.1||q.bottom>r.bottom+.1}).map(c=>c.getAttribute('data-checker')||c.getAttribute('style'));
 const stacks=[];for(const color of [0,1])for(const loc of new Set([...svg.querySelectorAll('g.ck')].map(c=>c.dataset.loc))){const cs=[...svg.querySelectorAll(`g.ck[data-color="${color}"][data-loc="${loc}"]`)];if(cs.length>=6&&loc!=='off'){const group=document.createElementNS('http://www.w3.org/2000/svg','g');cs.forEach(c=>group.append(c.cloneNode(true)));svg.append(group);stacks.push({n:cs.length,height:group.getBBox().height});group.remove();}}
 return {rimCount:svg.querySelectorAll('[data-checker-rim]').length,expectedRims:svg.querySelectorAll('g.ck').length-svg.querySelectorAll('g.ck > rect').length,stacks,ratio:r.height/innerHeight,diameter:document.querySelector('g.ck circle').getBoundingClientRect().width,rotated:!!svg.querySelector('[transform*="matrix(0 1"]'),viewBox:svg.getAttribute('viewBox'),rings:document.querySelectorAll('[data-hint="movable"]').length,expected:props?props.movable.size-(props.selected&&props.movable.has(props.selected)?1:0):null,targets:document.querySelectorAll('[data-hint="target"],[data-hint="target-off"]').length,expectedTargets:props?.targets.size,outside:offenders};});
 console.log(width+' '+theme+' '+JSON.stringify(values));
 if(values.rotated || !values.viewBox.startsWith('0 0 876 '))throw Error('empty right tray must be cropped '+JSON.stringify(values));
 if(width===360&&values.viewBox!=='0 0 876 1100')throw Error('portrait board geometry '+values.viewBox);
 if(width!==360&&values.viewBox!=='0 0 876 800')throw Error('desktop board geometry '+values.viewBox);
 if(values.outside.length)throw Error('checkers outside board: '+values.outside.join(','));
 if(values.rimCount!==values.expectedRims)throw Error('checker rims missing '+JSON.stringify(values));
 if(stacksBad(values))throw Error('stack too high '+JSON.stringify(values));
 if(process.env.HINT_GATE&&(values.rings!==values.expected||values.targets!==values.expectedTargets))throw Error('hint count mismatch '+JSON.stringify(values));
 fs.mkdirSync(IMPL_SCREEN_DIR,{recursive:true});await p.screenshot({path:`${IMPL_SCREEN_DIR}/${process.env.TASK||'task2'}-${width}-${theme}.png`});count++;await ctx.close();
}console.log(`console errors ${errors.length}, pages ${count}`,JSON.stringify(errors));await b.close();if(errors.length)process.exit(1);

}
function stacksBad(v){return v.stacks.some(s=>s.height>290.001)}
async function verifyInput() {
const b=await chromium.launch({channel:'chrome'}),c=await b.newContext({viewport:{width:360,height:780},isMobile:true,hasTouch:true});
await c.addInitScript(()=>localStorage.setItem('nardy.settings',JSON.stringify({version:1,state:{name:'Input',lang:'ru',theme:'wood',sound:false,speed:'instant',autoRoll:false,autoConfirm:false,hints:true,vibration:false}})));
const p=await c.newPage();let errors=[];p.on('pageerror',e=>errors.push(String(e)));p.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});
for(const mode of ['tap','drag']){
await p.goto('http://127.0.0.1:8787/play?mode=ai&variant=short&level=beginner');await p.waitForSelector('.status:has-text("Ваш ход")');
const roll=p.getByRole('button',{name:/^(🎲 )?Бросить$/,exact:true});if(await roll.count()){await roll.click()}
await p.waitForSelector('[data-hint="movable"]');
const before=await p.locator('[data-pips="me"]').textContent();
let found=false;
for(let i=0;i<8;i++){
 const candidates=p.locator('[data-hint="movable"]');if(i>=await candidates.count())break;
 const s=await candidates.nth(i).boundingBox();await p.mouse.click(s.x+s.width/2,s.y+s.height/2);await p.waitForTimeout(50);
 if(await p.locator('[data-hint="target"] circle').count()){found=true;break;}
 if((await p.locator('[data-pips="me"]').textContent())!==before){await p.getByRole('button',{name:'Отменить',exact:true}).click();await p.waitForTimeout(50);}
}
if(!found)throw Error(mode+' source produced no targets');
const t=await p.locator('[data-hint="target"] circle').first().boundingBox();
if(mode==='tap')await p.mouse.click(t.x+t.width/2,t.y+t.height/2);
else {const selected=await p.locator('[data-hint="selected"]').boundingBox();await p.mouse.move(selected.x+selected.width/2,selected.y+selected.height/2);await p.mouse.down();await p.mouse.move(t.x+t.width/2,t.y+t.height/2,{steps:10});await p.mouse.up();}
await p.waitForTimeout(100);const after=await p.locator('[data-pips="me"]').textContent();
if(after===before)throw Error(mode+' failed: pips unchanged '+before);
console.log(mode+' input pips '+before+' -> '+after);
}await p.setViewportSize({width:780,height:360});await p.waitForTimeout(50);if(await p.locator('.board-wrap.compact-board').count())throw Error('landscape retained portrait sizing');console.log('landscape 780x360 horizontal; console errors '+errors.length);await b.close();if(errors.length)throw Error(errors.join('\n'));

}

async function verifyStates() {
  const fs=require('fs'),path=require('path'),os=require('os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nardy-qa-'));
  require('child_process').execFileSync(path.resolve('node_modules/.bin/esbuild'),['packages/core/src/index.ts','--bundle','--format=esm','--platform=node','--outfile='+path.join(dir,'core.mjs')]);
  const core=await import('file://'+path.join(dir,'core.mjs'));
  const make=(variant)=>{let i=0;return core.newMatch({variant,matchLength:3,cube:variant==='short'},()=>[6,1][i++%2])};
  const short=make('short');
  const roll={...short,phase:'roll',remaining:[],dice:[],opening:null,event:null};
  const opponent={...roll,turn:1};
  let stack=make('long');stack.board.pts[0].fill(0);stack.board.pts[0][0]=10;stack.board.pts[0][4]=5;
  stack=core.applyAction(stack,{type:'roll',player:0,dice:[1,2]});
  const b=await chromium.launch({channel:'chrome'});let pageCount=0;const stateErrors=[];
  for(const [width,height] of [[360,780],[768,1024],[1440,900]])for(const theme of ['wood','minimal','malachite','night'])for(const state of ['own','opponent','roll','double','undo','stack10']){
    const m=state==='opponent'?opponent:state==='roll'||state==='double'?roll:state==='stack10'?stack:short;
    const ctx=await b.newContext({viewport:{width,height},isMobile:width===360,hasTouch:width===360});
    await ctx.addInitScript(({theme,m,state})=>{
      localStorage.setItem('nardy.settings',JSON.stringify({version:1,state:{name:'QA',lang:'ru',theme,sound:false,speed:'instant',autoRoll:state==='double',autoConfirm:true,hints:true,shake:false,vibration:false}}));
      localStorage.setItem('nardy.aiGame',JSON.stringify({match:m,level:'beginner',names:['QA','Opponent']}));
    },{theme,m,state});
    const p=await ctx.newPage();p.on('pageerror',e=>stateErrors.push(String(e)));p.on('console',msg=>{if(msg.type()==='error')stateErrors.push(msg.text())});
    if(state==='opponent'){await p.clock.install();await p.clock.pauseAt(new Date());}
    await p.goto(BASE+'/play?resume=1');await p.waitForSelector('.board-svg');
    if(state==='own'){
      await p.locator('[data-hint="movable"]').first().waitFor();
      const measured={rings:await p.locator('[data-hint="movable"]').count(),selected:await p.locator('[data-hint="selected"]').count(),expected:new Set(core.legalNextSteps(core.turnState(short)).map(step=>step.from)).size};
      if(measured.rings+measured.selected!==measured.expected||measured.rings===0)throw Error('movable ring mismatch '+JSON.stringify(measured));
      console.log(`${width} ${theme} short movable rings ${measured.rings} + selected ${measured.selected}, expected ${measured.expected}`);
      const loc=await p.locator('[data-hint="movable"]').first().evaluate(g=>g.closest('g.ck').dataset.loc);
      const expectedTargets=new Set(core.destinationsFrom(core.turnState(short),23-Number(loc.slice(1))).map(d=>d.to)).size;
      await tap(p,p.locator('[data-hint="movable"]'));
      await p.locator('[data-hint="target"]').first().waitFor();
      const targetCount=await p.locator('[data-hint="target"], [data-hint="target-off"]').count();
      if(targetCount!==expectedTargets)throw Error('target count '+targetCount+' expected '+expectedTargets);
      console.log(`${width} ${theme} selected targets ${targetCount}, expected ${expectedTargets}`);
    }
    if(state==='opponent'&&!(await p.locator('.status').innerText()).includes('Ход соперника'))throw Error('opponent state missing');
    if(state==='roll')await p.getByRole('button',{name:/^(🎲 )?Бросить$/,exact:true}).waitFor();
    if(state==='double'){
      await p.locator('button.btn.gold .countdown').waitFor();
      const started=Date.now();await p.waitForSelector('.dice-tray:not(.single) .die-wrap');
      console.log(`${width} ${theme} double countdown rolled after ${Date.now()-started}ms`);
      // Restore the roll state to capture the countdown itself.
      await ctx.close();const shotCtx=await b.newContext({viewport:{width,height},isMobile:width===360,hasTouch:width===360});
      await shotCtx.addInitScript(({theme,m})=>{localStorage.setItem('nardy.settings',JSON.stringify({version:1,state:{lang:'ru',theme,sound:false,speed:'instant',autoRoll:true,autoConfirm:true,hints:true,vibration:false}}));localStorage.setItem('nardy.aiGame',JSON.stringify({match:m,level:'beginner',names:['QA','Opponent']}))},{theme,m});
      const shot=await shotCtx.newPage();shot.on('pageerror',e=>stateErrors.push(String(e)));shot.on('console',msg=>{if(msg.type()==='error')stateErrors.push(msg.text())});await shot.goto(BASE+'/play?resume=1');await shot.locator('button.btn.gold .countdown').waitFor();
      if(width===360){
        const geometry=await shot.evaluate(()=>{const a=document.querySelector('.action-bar').getBoundingClientRect(),r=document.querySelector('.board-wrap').getBoundingClientRect();return {actionsBottom:a.bottom,viewport:innerHeight,boardWidth:r.width,boardHeight:r.height}});
        if(geometry.actionsBottom>height-11.9||Math.abs(geometry.boardWidth-344)>.1||Math.abs(geometry.boardHeight-431.953125)>.1)throw Error('double actions clipped or board resized '+JSON.stringify(geometry));
      }
      await shot.screenshot({path:`${IMPL_SCREEN_DIR}/final-${state}-${width}-${theme}.png`});await shotCtx.close();pageCount+=2;continue;
    }
    if(state==='undo')await finishPending(p);
    if(state==='stack10'){
      const height=await p.evaluate(()=>{const cs=[...document.querySelectorAll('g.ck[data-color="0"]')].filter(c=>c.dataset.loc==='s23'),g=document.createElementNS('http://www.w3.org/2000/svg','g');cs.forEach(c=>g.append(c.cloneNode(true)));document.querySelector('svg').append(g);const h=g.getBBox().height;g.remove();return {height:h,count:cs.length}});
      if(height.count!==10||height.height>290.001)throw Error('10-stack height '+height);console.log(`${width} ${theme} stack10 height ${height.height}, count ${height.count}`);
    }
    await p.screenshot({path:`${IMPL_SCREEN_DIR}/final-${state}-${width}-${theme}.png`});pageCount++;await ctx.close();
  }
  await b.close();fs.rmSync(dir,{recursive:true});console.log('state matrix pages '+pageCount+', console errors '+stateErrors.length);if(stateErrors.length)throw Error(stateErrors.join('\n'));
}

async function rollRecovery(b) {
 const a=await mk(b,'Roll A'),other=await mk(b,'Roll B');
 await a.evaluate(()=>{const s=JSON.parse(localStorage.getItem('nardy.settings'));Object.assign(s.state,{autoRoll:true,speed:'instant'});localStorage.setItem('nardy.settings',JSON.stringify(s))});
 let cut=false,rolls=0,seq=-1;
 await a.routeWebSocket(/\/ws$/,ws=>{const srv=ws.connectToServer();srv.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.t==='state'&&m.match)seq=m.match.seq;ws.send(raw)});ws.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.t==='roll'){rolls++;if(!cut){cut=true;ws.close();return;}}srv.send(raw)})});
 const r=await fetch(BASE+'/api/rooms',{method:'POST',body:JSON.stringify({settings:{variant:'long',isPublic:false,moveTimer:0,bank:0}})}),{id}=await r.json();await a.goto(BASE+'/r/'+id);await other.goto(BASE+'/r/'+id);await a.waitForSelector('.board-svg');
 if(!await a.locator('.status:has-text("Ваш ход")').count())await playTurn(other);
 const until=Date.now()+8000;while(rolls<2&&Date.now()<until)await a.waitForTimeout(50);
 if(rolls!==2)throw Error(`auto-roll stuck after reconnect: roll frames ${rolls}, seq ${seq}`);
 await a.waitForSelector('.dice-tray:not(.single) .die-wrap');console.log(`auto-roll reconnect: ${rolls} frames, seq ${seq}`);await a.context().close();await other.context().close();
}
async function reviewBoard(b) {
 const fs=require('fs'),path=require('path'),os=require('os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'nardy-board-'));
 require('child_process').execFileSync(path.resolve('node_modules/.bin/esbuild'),['packages/core/src/index.ts','--bundle','--format=esm','--platform=node','--outfile='+path.join(dir,'core.mjs')]);
 const core=await import('file://'+path.join(dir,'core.mjs'));let i=0;let m=core.newMatch({variant:'short',matchLength:3,cube:false},()=>[6,1][i++%2]);
 m.board.pts[0].fill(0);m.board.pts[1].fill(0);m.board.pts[0][0]=5;m.board.pts[0][6]=5;m.board.pts[0][12]=5;m.board.pts[1][0]=15;
 const c=await b.newContext({viewport:{width:1100,height:900}});await c.addInitScript(m=>{localStorage.setItem('nardy.settings',JSON.stringify({version:1,state:{lang:'ru',theme:'wood',sound:false,speed:'instant',autoRoll:false,autoConfirm:false,hints:true,vibration:false}}));localStorage.setItem('nardy.aiGame',JSON.stringify({match:m,level:'beginner',names:['QA','Opponent']}))},m);
 const p=await c.newPage();p.on('pageerror',e=>errors.push('review board: '+e));p.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});await p.goto(BASE+'/play?resume=1');await p.waitForSelector('g.ck[data-loc="s23"]');
 async function drag(from,to){const a=await p.locator(`g.ck[data-color="0"][data-loc="${from}"]`).last().boundingBox(),svg=await p.locator('.board-svg').boundingBox();const vb=(await p.locator('.board-svg').getAttribute('viewBox')).split(' ').map(Number);const slot=Number(to.slice(1)),x=slot<=5?468+(5-slot)*64+32:slot<=11?24+(11-slot)*64+32:slot<=17?24+(slot-12)*64+32:468+(slot-18)*64+32,y=slot>=12?53:747;await p.mouse.move(a.x+a.width/2,a.y+a.height/2);await p.mouse.down();await p.mouse.move(svg.x+x*svg.width/vb[2],svg.y+y*svg.height/vb[3],{steps:10});await p.mouse.up();await p.waitForTimeout(50);}
 await drag('s23','s17');await drag('s11','s10');
 const top=await p.locator('g.ck[data-color="0"][data-loc="s17"]').last().locator('text').textContent({timeout:1000}).catch(()=>null);
 if(top!=='6')throw Error('compressed stack logical top hidden: last painted checker count '+top);
 console.log('compressed stack logical top painted last: count 6');
 await p.getByRole('button',{name:'Готово',exact:true}).click();
 await p.waitForFunction(()=>{const m=JSON.parse(localStorage.getItem('nardy.aiGame')).match;return m.phase==='move'&&m.turn===1},null,{polling:10,timeout:3000});await p.waitForTimeout(20);
 const dims=await p.locator('g.ck[data-color="1"]').evaluateAll(cs=>cs.filter(x=>Number(getComputedStyle(x).opacity)<1).length);
 if(dims)throw Error('opponent turn stale dimming: '+dims+' checkers');console.log('opponent turn dimmed checkers: 0');await c.close();fs.rmSync(dir,{recursive:true});
}

async function verifyGhosts(b) {
 const fs=require('fs'),os=require('os'),path=require('path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'nardy-ghost-'));
 const entry=`import {createRoot} from ${JSON.stringify(path.resolve('node_modules/react-dom/client.js'))};
 import {BoardView} from ${JSON.stringify(path.resolve('apps/web/src/components/Board.tsx'))};
 import {initialBoard} from ${JSON.stringify(path.resolve('packages/core/src/index.ts'))};
 const root=createRoot(document.getElementById('root'));
 window.reviewRender=(kind)=>{const b=initialBoard('short');b.pts[0].fill(0);b.pts[1].fill(0);b.pts[0][0]=15;b.pts[1][0]=15;
 if(kind==='hit'){b.pts[1][0]=14;b.pts[1][22]=1;}
 if(kind==='stack'){b.pts[0][0]=5;b.pts[0][6]=10;}
 if(kind==='borne'){b.pts[0][0]=14;b.off[0]=1;}
 root.render(<BoardView board={b}  variant="short" viewer={0} mover={kind==='off'?1:0} theme="wood" moveMs={0} movable={new Set()} dimMovable={new Set()} selected="s23" targets={new Set(kind==='borne'?[]:[kind==='hit'?'s22':kind==='stack'?'s17':'off'])} lastMove={new Set()} hints={true} onLocClick={()=>{}} onDrop={()=>{}}/>);};window.reviewRender('hit');`;
 const code=require('child_process').execFileSync(path.resolve('node_modules/.bin/esbuild'),['--bundle','--format=iife','--platform=browser','--loader=tsx','--jsx=automatic','--tsconfig=apps/web/tsconfig.json','--sourcefile='+path.resolve('e2e/ghost-fixture.tsx')],{input:entry,encoding:'utf8',maxBuffer:8*1024*1024});
 const p=await b.newPage({viewport:{width:1100,height:900}});p.on('pageerror',e=>errors.push('ghost: '+e));p.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});
 await p.setContent('<div id="root" style="width:1000px;height:800px"></div>');await p.addScriptTag({content:code});
 await p.locator('[data-hint="target"] circle').first().waitFor();
 if((await p.locator('svg').getAttribute('viewBox'))!=='0 0 876 800')throw Error('empty tray reserved space');
 if(await p.locator('[data-selected-mark]').count()!==1)throw Error('selected checker badge missing');
 if((await p.locator('[data-field-surface]').first().getAttribute('y'))!=='53')throw Error('rounded point bed must expose frame material');
 const cy=await p.locator('[data-hint="target"] circle').first().getAttribute('cy');if(cy!=='53')throw Error('hit ghost y '+cy+' expected 53');
 await p.evaluate(()=>window.reviewRender('stack'));await p.locator('[data-target="s17"]').waitFor();
 const layer=await p.locator('[data-target="s17"]').evaluate(g=>{const cs=[...document.querySelectorAll('g.ck')];return {y:g.querySelector('circle').getAttribute('cy'),above:!!(cs.at(-1).compareDocumentPosition(g)&Node.DOCUMENT_POSITION_FOLLOWING)}});
 if(layer.y!=='285'||!layer.above)throw Error('stack ghost hidden or misplaced '+JSON.stringify(layer));
 await p.evaluate(()=>window.reviewRender('off'));await p.locator('[data-hint="target-off"] rect').first().waitFor();const y=await p.locator('[data-hint="target-off"] rect').first().getAttribute('y');if(y!=='27')throw Error('opponent off tray y '+y+' expected 27');
 await p.evaluate(()=>window.reviewRender('borne'));await p.locator('g.ck[data-loc="off"]').waitFor();if((await p.locator('svg').getAttribute('viewBox'))!=='0 0 1000 800')throw Error('borne-off tray missing');
 console.log('tray: empty cropped to876, off target and borne-off checker use1000');
 console.log('ghosts: hit y=53; 10-stack landing y=285 above checkers; opponent tray y=27');await p.close();fs.rmSync(dir,{recursive:true});
}

async function captureThemes() {
 const prefix=process.env.PREVIEW_PREFIX || 'handover';
 require('fs').mkdirSync(IMPL_SCREEN_DIR,{recursive:true});
 const b=await chromium.launch({channel:'chrome'});
 for(const theme of ['wood','minimal','malachite','night']){
   const pages=[];
   for(const name of ['Алиса','Борис']) {
     const p=await mk(b,name,{viewport:{width:360,height:780},isMobile:true,hasTouch:true});
     await p.evaluate(theme=>{const s=JSON.parse(localStorage.getItem('nardy.settings'));s.state.theme=theme;s.state.speed='instant';localStorage.setItem('nardy.settings',JSON.stringify(s))},theme);pages.push(p);
   }
   const response=await fetch(BASE+'/api/rooms',{method:'POST',body:JSON.stringify({settings:{variant:'short',matchLength:3,cube:false,isPublic:false,moveTimer:15,bank:180}})}),{id}=await response.json();
   for(const p of pages)await p.goto(BASE+'/r/'+id);
   for(const p of pages)await p.waitForSelector('.board-svg');
   const p=(await pages[0].locator('.status:has-text("Ваш ход")').count())?pages[0]:pages[1];
   await p.locator('[data-hint="movable"]').first().waitFor();
   const ringCount=await p.locator('[data-hint="movable"]').count();
   // Opening short games have several candidates. Select one with multiple destinations.
   for(let i=0;i<ringCount;i++){
     const before=await p.locator('[data-pips="me"]').textContent();
     const ring=p.locator('[data-hint="movable"]').nth(i);if(!await ring.count())break;
     await tap(p,ring);await p.waitForTimeout(50);
     if(await p.locator('[data-hint="target"]').count())break;
     if((await p.locator('[data-pips="me"]').textContent())!==before){await p.getByRole('button',{name:'Отменить',exact:true}).click();await p.waitForTimeout(50)}
   }
   await p.locator('[data-hint="target"]').first().waitFor();
   const measured=await p.evaluate(()=>{const r=document.querySelector('.board-wrap').getBoundingClientRect(),h=document.querySelector('.mobile-hud').getBoundingClientRect();return {top:r.top,width:r.width,height:r.height,bottomGap:innerHeight-h.bottom,movable:document.querySelectorAll('[data-hint="movable"]').length,selected:document.querySelectorAll('[data-hint="selected"]').length,targets:document.querySelectorAll('[data-hint="target"]').length,rims:document.querySelectorAll('[data-checker-rim]').length}});
   // Measured after moving the opponent strip above the board; width/height stay unchanged.
   if(Math.abs(measured.top-140.390625)>.1||Math.abs(measured.width-344)>.1||Math.abs(measured.height-431.953125)>.1||Math.abs(measured.bottomGap-12)>.1||measured.rims!==30)throw Error('preview geometry/rims '+JSON.stringify(measured));
   for(const kind of ['movable','selected','target','seat']){
     await p.evaluate(kind=>{
       const svg=document.querySelector('.board-svg'),node=svg.querySelector(kind==='seat'?'[data-point-seat="9"]':`[data-hint="${kind}"]`),rect=node.getBoundingClientRect();
       const center=kind==='seat'?new DOMPoint(184,Number(svg.getAttribute('viewBox').split(' ')[3])-53):new DOMPoint(rect.x+rect.width/2,rect.y+rect.height/2).matrixTransform(svg.getScreenCTM().inverse());
       const panel=document.createElement('div');panel.id='hint-detail';panel.style.cssText='position:fixed;left:0;top:0;width:180px;height:180px;z-index:99999;background:#11151d';
       const clone=svg.cloneNode(true);clone.removeAttribute('class');clone.setAttribute('viewBox',kind==='seat'?`${center.x-46} ${center.y-32} 92 92`:`${center.x-42} ${center.y-42} 84 84`);clone.style.cssText='width:180px;height:180px;display:block';panel.append(clone);document.body.append(panel);
     },kind);
     await p.locator('#hint-detail').screenshot({path:`${IMPL_SCREEN_DIR}/${prefix}-detail-${kind}-${theme}.png`});
     await p.evaluate(()=>document.querySelector('#hint-detail').remove());
   }
   const bed=await p.locator('[data-field-surface]').first().getAttribute('y');if(bed!=='53')throw Error('frame bed not exposed '+bed);if(await p.locator('[data-selected-mark]').count()!==1)throw Error('selected badge missing');
   await p.mouse.move(0,0);await p.screenshot({path:`${IMPL_SCREEN_DIR}/${prefix}-hints-360-${theme}.png`});
   const beforeUndo=await finishPending(p);
   await p.locator('button.undo-send').waitFor();
   await p.screenshot({path:`${IMPL_SCREEN_DIR}/${prefix}-undo-360-${theme}.png`});
   await p.locator('button.undo-send').click();await p.locator('button.undo-send').waitFor({state:'hidden'});
   const afterUndo=await p.locator('[data-pips="me"]').textContent();if(afterUndo!==beforeUndo)throw Error(`undo ${beforeUndo} -> ${afterUndo}`);
   const urlBefore=p.url();
   await p.evaluate(()=>{window.__previewBoard=document.querySelector('.board-svg')});
   await p.getByRole('button',{name:'Настройки',exact:true}).click();
   const settings=p.getByRole('dialog',{name:'Настройки',exact:true});await settings.waitFor();
   const hintToggle=settings.getByRole('checkbox',{name:'Подсказки ходов',exact:true});
   await hintToggle.uncheck();
   if(await p.evaluate(()=>JSON.parse(localStorage.getItem('nardy.settings')).state.hints))throw Error('settings did not persist hints off');
   await hintToggle.check();
   if(await settings.evaluate(element=>element.scrollWidth-element.clientWidth)>1)throw Error('settings horizontal overflow');
   await p.screenshot({path:`${IMPL_SCREEN_DIR}/${prefix}-settings-360-${theme}.png`});
   await p.keyboard.press('Escape');await settings.waitFor({state:'hidden'});
   if(p.url()!==urlBefore||!await p.evaluate(()=>window.__previewBoard===document.querySelector('.board-svg')))throw Error('settings exited or remounted game');
   const boardAfter=await p.locator('.board-wrap').boundingBox();
   if(Math.abs(boardAfter.y-measured.top)>.1||Math.abs(boardAfter.width-measured.width)>.1||Math.abs(boardAfter.height-measured.height)>.1)throw Error('settings changed board geometry '+JSON.stringify({before:measured,after:boardAfter}));
   console.log(theme+' '+JSON.stringify(measured)+' undo restored '+afterUndo+'; settings persisted and returned to same mounted board');
   for(const page of pages)await page.context().close();
 }
 await b.close();console.log('console errors '+errors.length+' on 6 online pages');if(errors.length)throw Error(errors.join('\n'));
}

(async () => {
  if (process.env.PREVIEW_ONLY) { await captureThemes(); return; }
  if (process.env.STATES_ONLY) { await verifyStates(); return; }
  if (process.env.LAYOUT_ONLY) { await verifyLayouts(); await verifyInput(); return; }
  if (process.env.INPUT_ONLY) { await verifyInput(); return; }
  const b = await chromium.launch({ channel: 'chrome' });
  if (process.env.GHOST_ONLY) {await verifyGhosts(b);await b.close();return;}
  if (process.env.REVIEW_ONLY) {if(!process.env.BOARD_ONLY)await rollRecovery(b);await reviewBoard(b);await verifyGhosts(b);await b.close();return;}
  if (process.env.REJOIN_ONLY) {await rejoinScenario(b);await b.close();if(errors.length)throw Error(JSON.stringify(errors));return;}
  if (!process.env.RECOVERY_ONLY) await autoFlow(b);
  await recovery(b, 'drop');
  await recovery(b, 'reject');
  await rollRecovery(b);
  await reviewBoard(b);
  await verifyGhosts(b);
  if (process.env.T2_ONLY) { await b.close(); return; }
  const A = await mk(b, 'Алиса');
  const B = await mk(b, 'Борис');
  await A.goto(BASE + '/create');
  await A.locator('.variant-card:has-text("Короткие")').click();
  await A.locator('input[type=password]').fill('42');
  await A.locator('button:has-text("Создать")').last().click();
  await A.waitForURL(/\/r\//);
  const url = A.url();
  await A.waitForSelector('text=Ждём соперника');
  await A.screenshot({ path: OUT + '/10-waiting.png' });
  // lobby shows it
  await B.goto(BASE + '/online');
  await B.waitForSelector('.room-card2');
  await B.screenshot({ path: OUT + '/11-lobby.png' });
  await B.goto(url);
  await B.locator('input[type=password]').fill('wrong');
  await B.locator('button:has-text("Войти")').click();
  await B.waitForSelector('text=Неверный пароль');
  await B.locator('input[type=password]').fill('42');
  await B.locator('button:has-text("Войти")').click();
  await B.waitForSelector('.board-svg');
  await A.waitForSelector('.board-svg');
  console.log('both in game');
  const initialPips = await A.locator('.pmeta').allTextContents();
  // play some turns
  let reloaded = false;
  for (let i = 0; i < 14; i++) {
    for (const p of [A, B]) {
      const mine = await p.locator('.status:has-text("Ваш ход")').count();
      if (mine) await playTurn(p);
    }
    await A.waitForTimeout(400);
    if (i === 5 && !reloaded) {
      await B.reload();
      await B.waitForSelector('.board-svg', { timeout: 10000 });
      reloaded = true;
      console.log('B reloaded and back in game');
    }
  }
  await A.screenshot({ path: OUT + '/12-online-A.png' });
  await B.screenshot({ path: OUT + '/13-online-B.png' });
  // chat & emoji
  if (await A.locator('button[aria-label="Чат"]').count()) await A.locator('button[aria-label="Чат"]').click(); // wide layout: chat panel always open
  await A.locator('.chat-form input').fill('Привет, удачи!');
  await A.locator('.chat-form button').click();
  await A.getByRole('button',{name:'Реакции',exact:true}).click();await A.getByRole('menuitem').nth(5).click();
  await B.waitForSelector('.float-emoji');
  if (await B.locator('button[aria-label="Чат"]').count()) await B.locator('button[aria-label="Чат"]').click(); // wide layout: chat panel always open
  await B.waitForSelector('text=Привет, удачи!');
  await B.screenshot({ path: OUT + '/14-chat.png' });
  const pipsA = await A.locator('.pmeta').allTextContents();
  const pipsB = await B.locator('.pmeta').allTextContents();
  console.log('pips A view', pipsA, 'B view', pipsB);
  if (pipsA.length !== 2 || pipsA.some((v,i)=>v===initialPips[i])) throw new Error('pips unchanged: initial '+initialPips+' final '+pipsA);
  // resign -> result modal
  await A.getByRole('button',{name:'Ещё',exact:true}).click();await A.getByRole('button',{name:'Сдаться',exact:true}).click();
  await A.locator('.modal button:has-text("Да")').click();
  await A.waitForSelector('.result');
  await B.waitForSelector('.result');
  await B.screenshot({ path: OUT + '/15-result-B.png' });

  await rejoinScenario(b);

  // mobile shake
  const M = await mk(b, 'Мобила', { ...devices['Pixel 7'], permissions: ['accelerometer','gyroscope'] });
  await M.goto(BASE + '/play?mode=ai&variant=long&len=1&cube=0&level=beginner');
  await M.waitForSelector('button:has-text("Бросить")');
  const btn = M.locator('button:has-text("Включить встряхивание")');
  if (await btn.count()) await btn.click();
  for (let i = 0; i < 8; i++) {
    await M.evaluate((i) => {
      const v = i % 2 ? 20 : -20;
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: v, y: -v, z: 9.8 } }));
    }, i);
    await M.waitForTimeout(90);
    if (i === 4) await M.screenshot({ path: OUT + '/16-mobile-shaking.png' });
  }
  await M.waitForTimeout(1500);
  const rolled = await M.locator('.dice-tray:not(.single) .die-wrap').count();
  console.log('mobile dice after shake:', rolled);
  await M.screenshot({ path: OUT + '/17-mobile-after-shake.png' });
  if (rolled !== 2) throw new Error('shake dice expected 2, found ' + rolled);
  console.log('ERRORS:', JSON.stringify(errors, null, 1));
  await b.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e); console.log('ERRORS:', JSON.stringify(errors, null, 1)); process.exit(1); });
