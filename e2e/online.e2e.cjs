// Browser e2e: two players online (password, lobby, reconnect, chat, emoji, resign) + shake-to-roll on a phone.
// Usage: npm run build && (cd worker && npx wrangler dev) & node e2e/online.e2e.cjs [screenshot-dir]
const { chromium, devices } = require('playwright');
const OUT = process.argv[2] || 'e2e-shots';
require('fs').mkdirSync(OUT, { recursive: true });
const BASE = process.env.NARDY_URL || 'http://127.0.0.1:8787';
const settings = (name) => JSON.stringify({ state: { name, lang: 'ru', theme: 'wood', sound: false, speed: 'fast', autoRoll: false, autoConfirm: true, hints: true, shake: true, vibration: false }, version: 0 });
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
(async () => {
  const b = await chromium.launch();
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
  console.log('ERRORS:', JSON.stringify(errors, null, 1));
  await b.close();
})().catch((e) => { console.error('FAIL', e); console.log('ERRORS:', JSON.stringify(errors, null, 1)); process.exit(1); });
