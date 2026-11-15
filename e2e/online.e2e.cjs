// Browser e2e: two players online (password, lobby, reconnect, chat, emoji, resign) + shake-to-roll on a phone.
// Usage: npm run build && (cd worker && npx wrangler dev) & node e2e/online.e2e.cjs [screenshot-dir]
const { chromium, devices } = require('playwright');
const OUT = process.argv[2] || 'e2e-shots';
require('fs').mkdirSync(OUT, { recursive: true });
const BASE = process.env.NARDY_URL || 'http://127.0.0.1:8787';
const settings = (name) => JSON.stringify({ state: { name, lang: 'ru', theme: 'wood', sound: false, speed: 'fast', autoRoll: false, autoConfirm: true, hints: true, shake: true, vibration: false }, version: 1 });
const errors = [];
async function mk(b, name, opts = { viewport: { width: 1100, height: 900 } }) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(name + ': ' + e + '\n' + (e.stack||'').split('\n').slice(0,6).join('\n')));
  p.on('console', (m) => m.type() === 'error' && !m.text().includes('vibrate') && errors.push(name + ' console: ' + m.text()));
  await p.goto(BASE + '/');
  await p.evaluate((s) => localStorage.setItem('nardy.settings', s), settings(name));
  return p;
}
async function playTurn(p) {
  const roll = p.locator('button:has-text("Бросить")');
  if (await roll.count()) { await roll.click(); await p.waitForTimeout(700); }
  for (let k = 0; k < 6; k++) {
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
  throw new Error('undo window missing after completing turn: ' + await p.locator('.controls').innerText());
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
  await p.waitForFunction(() => document.querySelectorAll('.dice-tray:not(.single) .die-wrap').length === 2, {timeout:1500});
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
    await a.locator('button:has-text("✓")').waitFor({timeout:3000});
    await a.waitForTimeout(1500);
    if(frames!==1)throw new Error('rejected move auto-resent: frames='+frames);
    await a.locator('button:has-text("✓")').click();
  } else {
    const deadline=Date.now()+15000; let recovered=false;
    while(Date.now()<deadline && seq<=initialSeq) {
      if(await a.locator('button.undo-send, button:has-text("✓")').count())recovered=true;
      await a.waitForTimeout(50);
    }
    if(!recovered || seq<=initialSeq)throw new Error('stuck: seq='+seq+' initial='+initialSeq+' controls='+await a.locator('.controls').innerText());
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
  await old.waitForSelector('.board-svg');await old.context().close();await a.waitForTimeout(400);
  const c=await mk(b,'');await c.goto(url);
  await c.getByText('Вернуться в игру как Борис',{exact:true}).waitFor({timeout:3000});
  if(process.env.REJOIN_SHOTS)for(const [width,height] of [[360,780],[768,1024],[1440,900]])for(const theme of ['wood','minimal','malachite']){
    await c.setViewportSize({width,height});await c.evaluate(theme=>{const s=JSON.parse(localStorage.getItem('nardy.settings'));s.state.theme=theme;localStorage.setItem('nardy.settings',JSON.stringify(s))},theme);await c.reload();await c.getByText('Вернуться в игру как Борис',{exact:true}).waitFor();
    require('fs').mkdirSync('docs/design/impl-screens',{recursive:true});await c.screenshot({path:`docs/design/impl-screens/task4-${width}-${theme}.png`});
  }
  await c.locator('input[type=password]').fill('wrong');await c.getByRole('button',{name:'Вернуться',exact:true}).click();await c.getByText('Неверный пароль',{exact:true}).waitFor();
  await c.locator('input[type=password]').fill('42');await c.getByRole('button',{name:'Вернуться',exact:true}).click();await c.waitForSelector('.game-top .score');
  await a.locator('.pbar .tag.warn').waitFor({state:'hidden',timeout:3000});
  if(!await a.getByText('Борис',{exact:true}).count())throw Error('rejoin fallback name is not Борис');
  const d=await mk(b,'D');await d.goto(url);await d.getByText('Комната заполнена',{exact:true}).waitFor();
  if(await d.locator('input[type=password]').count())throw Error('full room prompted for password');
  console.log('rejoin: wrong password rejected, right password welcomed as Борис; full online room no password input');
  for(const p of [a,c,d])await p.context().close();
}

async function verifyLayouts() {
  const fs=require('fs');
const b=await chromium.launch({channel:'chrome'});let errors=[];let count=0;
for(const [width,height] of [[360,780],[768,1024],[1440,900]])for(const theme of ['wood','minimal','malachite']){
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
 return {stacks,ratio:r.height/innerHeight,diameter:document.querySelector('g.ck circle').getBoundingClientRect().width,vertical:!!document.querySelector('.board-wrap.vertical'),rings:document.querySelectorAll('[data-hint="movable"]').length,expected:props?props.movable.size-(props.selected&&props.movable.has(props.selected)?1:0):null,targets:document.querySelectorAll('[data-hint="target"],[data-hint="target-off"]').length,expectedTargets:props?.targets.size,outside:offenders};});
 console.log(width+' '+theme+' '+JSON.stringify(values));
 if(process.env.VERTICAL_GATE){if(width===360&&(values.ratio<.65||values.diameter<30))throw Error('vertical measurement '+JSON.stringify(values));if(width!==360&&values.vertical)throw Error('expected horizontal '+width);if(values.outside.length)throw Error('checkers outside board: '+values.outside.join(','));}
 if(stacksBad(values))throw Error('stack too high '+JSON.stringify(values));
 if(process.env.HINT_GATE&&(values.rings!==values.expected||values.targets!==values.expectedTargets))throw Error('hint count mismatch '+JSON.stringify(values));
 fs.mkdirSync('docs/design/impl-screens',{recursive:true});await p.screenshot({path:`docs/design/impl-screens/${process.env.TASK||'task2'}-${width}-${theme}.png`});count++;await ctx.close();
}console.log(`console errors ${errors.length}, pages ${count}`,JSON.stringify(errors));await b.close();if(errors.length)process.exit(1);

}
function stacksBad(v){return v.stacks.some(s=>s.height>290.001)}
async function verifyInput() {
const b=await chromium.launch({channel:'chrome'}),c=await b.newContext({viewport:{width:360,height:780},isMobile:true,hasTouch:true});
await c.addInitScript(()=>localStorage.setItem('nardy.settings',JSON.stringify({version:1,state:{name:'Input',lang:'ru',theme:'wood',sound:false,speed:'instant',autoRoll:false,autoConfirm:false,hints:true}})));
const p=await c.newPage();let errors=[];p.on('pageerror',e=>errors.push(String(e)));
for(const mode of ['tap','drag']){
await p.goto('http://127.0.0.1:8787/play?mode=ai&variant=short&level=beginner');await p.waitForSelector('.status:has-text("Ваш ход")');
const roll=p.getByRole('button',{name:'🎲 Бросить',exact:true});if(await roll.count()){await roll.click()}
await p.waitForSelector('[data-hint="movable"]');
const before=await p.locator('[data-pips="me"]').textContent();
let found=false;
for(let i=0;i<8;i++){
 const candidates=p.locator('[data-hint="movable"]');if(i>=await candidates.count())break;
 const s=await candidates.nth(i).boundingBox();await p.mouse.click(s.x+s.width/2,s.y+s.height/2);await p.waitForTimeout(50);
 if(await p.locator('[data-hint="target"] circle').count()){found=true;break;}
 if((await p.locator('[data-pips="me"]').textContent())!==before){await p.getByRole('button',{name:'↶ Отменить',exact:true}).click();await p.waitForTimeout(50);}
}
if(!found)throw Error(mode+' source produced no targets');
const t=await p.locator('[data-hint="target"] circle').first().boundingBox();
if(mode==='tap')await p.mouse.click(t.x+t.width/2,t.y+t.height/2);
else {const selected=await p.locator('[data-hint="selected"]').boundingBox();await p.mouse.move(selected.x+selected.width/2,selected.y+selected.height/2);await p.mouse.down();await p.mouse.move(t.x+t.width/2,t.y+t.height/2,{steps:10});await p.mouse.up();}
await p.waitForTimeout(100);const after=await p.locator('[data-pips="me"]').textContent();
if(after===before)throw Error(mode+' failed: pips unchanged '+before);
console.log(mode+' input pips '+before+' -> '+after);
}await p.setViewportSize({width:780,height:360});await p.waitForTimeout(50);if(await p.locator('.board-wrap.vertical').count())throw Error('landscape is vertical');console.log('landscape 780x360 horizontal; console errors '+errors.length);await b.close();if(errors.length)throw Error(errors.join('\n'));

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
  for(const [width,height] of [[360,780],[768,1024],[1440,900]])for(const theme of ['wood','minimal','malachite'])for(const state of ['own','opponent','roll','double','undo','stack10']){
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
      await tap(p,p.locator('[data-hint="movable"]'));
      await p.locator('[data-hint="target"]').first().waitFor();
    }
    if(state==='opponent'&&!(await p.locator('.status').innerText()).includes('Ход соперника'))throw Error('opponent state missing');
    if(state==='roll')await p.getByRole('button',{name:'🎲 Бросить',exact:true}).waitFor();
    if(state==='double'){
      await p.locator('button.btn.gold .countdown').waitFor();
      const started=Date.now();await p.waitForSelector('.dice-tray:not(.single) .die-wrap');
      console.log(`${width} ${theme} double countdown rolled after ${Date.now()-started}ms`);
      // Restore the roll state to capture the countdown itself.
      await ctx.close();const shotCtx=await b.newContext({viewport:{width,height},isMobile:width===360,hasTouch:width===360});
      await shotCtx.addInitScript(({theme,m})=>{localStorage.setItem('nardy.settings',JSON.stringify({version:1,state:{lang:'ru',theme,sound:false,speed:'instant',autoRoll:true,autoConfirm:true,hints:true}}));localStorage.setItem('nardy.aiGame',JSON.stringify({match:m,level:'beginner',names:['QA','Opponent']}))},{theme,m});
      const shot=await shotCtx.newPage();await shot.goto(BASE+'/play?resume=1');await shot.locator('button.btn.gold .countdown').waitFor();await shot.screenshot({path:`docs/design/impl-screens/final-${state}-${width}-${theme}.png`});await shotCtx.close();pageCount+=2;continue;
    }
    if(state==='undo')await finishPending(p);
    if(state==='stack10'){
      const height=await p.evaluate(()=>{const cs=[...document.querySelectorAll('g.ck[data-color="0"]')].filter(c=>c.dataset.loc==='s23'),g=document.createElementNS('http://www.w3.org/2000/svg','g');cs.forEach(c=>g.append(c.cloneNode(true)));document.querySelector('svg').append(g);const h=g.getBBox().height;g.remove();return h});
      if(height>290.001)throw Error('10-stack height '+height);console.log(`${width} ${theme} stack10 height ${height}`);
    }
    await p.screenshot({path:`docs/design/impl-screens/final-${state}-${width}-${theme}.png`});pageCount++;await ctx.close();
  }
  await b.close();fs.rmSync(dir,{recursive:true});console.log('state matrix pages '+pageCount+', console errors '+stateErrors.length);if(stateErrors.length)throw Error(stateErrors.join('\n'));
}

(async () => {
  if (process.env.STATES_ONLY) { await verifyStates(); return; }
  if (process.env.LAYOUT_ONLY) { await verifyLayouts(); await verifyInput(); return; }
  if (process.env.INPUT_ONLY) { await verifyInput(); return; }
  const b = await chromium.launch({ channel: 'chrome' });
  if (process.env.REJOIN_ONLY) {await rejoinScenario(b);await b.close();if(errors.length)throw Error(JSON.stringify(errors));return;}
  if (!process.env.RECOVERY_ONLY) await autoFlow(b);
  await recovery(b, 'drop');
  await recovery(b, 'reject');
  if (process.env.T2_ONLY) { await b.close(); return; }
  const A = await mk(b, 'Алиса');
  const B = await mk(b, 'Борис');
  await A.goto(BASE + '/create');
  await A.locator('.seg button:has-text("Короткие")').click();
  await A.locator('input[type=password]').fill('42');
  await A.locator('button:has-text("Создать")').last().click();
  await A.waitForURL(/\/r\//);
  const url = A.url();
  await A.waitForSelector('text=Ждём соперника');
  await A.screenshot({ path: OUT + '/10-waiting.png' });
  // lobby shows it
  await B.goto(BASE + '/online');
  await B.waitForSelector('.room-card');
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
  await A.locator('button[aria-label="Чат"]').click();
  await A.locator('.chat-form input').fill('Привет, удачи!');
  await A.locator('.chat-form button').click();
  await A.locator('.emoji-bar button').nth(5).click();
  await B.waitForSelector('.float-emoji');
  await B.locator('button[aria-label="Чат"]').click();
  await B.waitForSelector('text=Привет, удачи!');
  await B.screenshot({ path: OUT + '/14-chat.png' });
  const pipsA = await A.locator('.pmeta').allTextContents();
  const pipsB = await B.locator('.pmeta').allTextContents();
  console.log('pips A view', pipsA, 'B view', pipsB);
  if (pipsA.length !== 2 || pipsA.some((v,i)=>v===initialPips[i])) throw new Error('pips unchanged: initial '+initialPips+' final '+pipsA);
  // resign -> result modal
  await A.locator('button:has-text("Сдаться")').click();
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
