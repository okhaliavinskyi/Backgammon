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
    const t = p.locator('circle.pulse[stroke-dasharray]').first();
    if (await t.count()) {
      const bb = await t.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(350); continue;
    }
    const tray = p.locator('rect.pulse').first();
    if (await tray.count()) { const bb = await tray.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(350); continue; }
    const ring = p.locator('g.ck circle.pulse').first();
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
    const target = p.locator('circle.pulse[stroke-dasharray], [data-hint="target"] circle').first();
    const off = p.locator('rect.pulse, [data-hint="target-off"] rect').first();
    const ring = p.locator('g.ck circle.pulse, [data-hint="movable"]').first();
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

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
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
