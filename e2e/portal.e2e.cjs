const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const origin = process.env.PORTAL_URL || 'http://localhost:8790';
const output = process.env.PORTAL_SHOTS || '/tmp/onlineboard-shots';
(async () => {
 mkdirSync(output, { recursive: true });
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 const errors = [];
 try {
  for (const width of [360, 768, 1440]) {
   const page = await browser.newPage({ viewport: {width, height: 900} });
   page.on('pageerror', e => errors.push(e.message));
   await page.goto(origin);
   assert.equal(await page.locator('.game-card').count(), 4);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.screenshot({path: `${output}/home-${width}.png`, fullPage: true});
   await page.getByRole('link', {name: 'Играть в нарды', exact: true}).click();
   await page.locator('.home2').waitFor();
   assert.equal(new URL(page.url()).pathname, '/backgammon/');
   await page.getByRole('button', {name: /ИИ|AI/}).click();
   assert.equal(new URL(page.url()).pathname, '/backgammon/ai');
   await page.reload();
   await page.locator('.page-head').waitFor();
   await page.goto(origin + '/backgammon/play?mode=ai&level=beginner');
   await page.locator('.board-svg').waitFor();
   await page.screenshot({path: `${output}/game-${width}.png`});
   await page.goto(origin + '/backgammon/');
   await page.locator('.portal-back').click();
   assert.equal(new URL(page.url()).pathname, '/');
   await page.close();
  }
  const p = await browser.newPage();
  for (const path of ['/backgammon', '/backgammon/manifest.webmanifest', '/backgammon/icon.svg', '/backgammon/api/health']) {
   const r = await p.request.get(origin + path);
   assert.equal(r.status(), 200, path);
  }
  const manifest = await (await p.request.get(origin + '/backgammon/manifest.webmanifest')).json();
  assert.equal(new URL(manifest.scope, origin + '/backgammon/manifest.webmanifest').pathname, '/backgammon/');
  assert.equal((await p.request.get(origin + '/missing')).status(), 404);
  assert.equal((await p.request.get(origin + '/backgammon/assets/missing.js')).status(), 404);
  await p.goto(origin + '/backgammon/');
  await p.evaluate(() => navigator.serviceWorker.ready);
  const scope = await p.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  assert.equal(new URL(scope).pathname, '/backgammon/');
  await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await p.reload();
  await p.locator('.home2').waitFor();
  await p.context().setOffline(true);
  await p.reload();
  await p.locator('.home2').waitFor();
  await p.context().setOffline(false);
  assert.deepEqual(errors, []);
  console.log('PASS: catalog, responsive layout, game navigation, AI worker, reload, return, assets, API, manifest, 404, scoped offline shell; no page errors');
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
