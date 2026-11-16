const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.NARDY_URL || 'http://127.0.0.1:8790';
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let expectedFailure = false;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('401 (Unauthorized)') && m.location().url === base + '/api/profile') return;
    if (expectedFailure && m.text().includes('503')) return;
    errors.push(m.text());
  });
  for (const lang of ['ru', 'en']) {
    await page.goto(base);
    await page.evaluate((lang) => localStorage.setItem('nardy.settings', JSON.stringify({ state: { lang }, version: 1 })), lang);
    for (const route of ['/privacy', '/terms', '/legal', '/online', '/create', '/settings']) {
      const response = await page.goto(base + route);
      await page.waitForSelector('#root > *');
      assert.equal(response.status(), 200);
      assert(response.headers()['content-security-policy'].includes("frame-ancestors 'none'"));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang}${route}: overflow`);
      if (route === '/privacy') {
        assert(await page.getByRole('button', { name: lang === 'ru' ? 'Удалить данные на этом устройстве' : 'Delete data on this device' }).count());
        await page.screenshot({ path: `/tmp/nardy-privacy-${lang}.png`, fullPage: true });
      }
    }
  }
  await page.goto(base + '/privacy');
  await page.evaluate(() => {
    localStorage.setItem('nardy.token.OLD123', 'old');
    localStorage.setItem('nardy.name.OLD123', 'old name');
    localStorage.setItem('nardy.seen.OLD123', String(Date.now() - 25 * 60 * 60 * 1000));
    localStorage.setItem('nardy.token.NEW123', 'legacy');
  });
  await page.reload();
  assert.equal(await page.evaluate(() => localStorage.getItem('nardy.token.OLD123')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('nardy.name.OLD123')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('nardy.token.NEW123')), 'legacy');
  await page.evaluate(() => { localStorage.setItem('nardy.test', 'private'); localStorage.setItem('unrelated', 'keep'); });
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Delete data on this device' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('nardy.test')), 'private');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete data on this device' }).click();
  await page.waitForURL(base + '/');
  assert.equal(await page.evaluate(() => localStorage.getItem('nardy.test')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('unrelated')), 'keep');
  // Confirmed server deletion is separate from losing a device cookie.
  const created = await context.request.post(base + '/api/profile');
  assert.equal(created.status(), 200);
  const profileCookie = (await context.cookies()).find((c) => c.name === 'nardy_guest');
  assert(profileCookie?.httpOnly);
  await page.goto(base + '/privacy');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download profile data' }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'nardy-profile.json');
  const exported = require('node:fs').readFileSync(await download.path(), 'utf8');
  assert.equal(JSON.parse(exported).profile.xp, 0);
  assert(!exported.includes(profileCookie.value));
  await page.evaluate(() => localStorage.setItem('nardy.test', 'keep-on-failure'));
  await page.route('**/api/profile', async route => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 503, body: '{}' });
    else await route.continue();
  });
  expectedFailure = true;
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete profile and device data' }).click();
  await page.getByRole('alert').filter({ hasText: 'The operation did not finish' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('nardy.test')), 'keep-on-failure');
  await page.unroute('**/api/profile');
  expectedFailure = false;
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete profile and device data' }).click();
  await page.waitForURL(base + '/');
  assert.equal(await page.evaluate(() => localStorage.getItem('nardy.test')), null);
  assert(!(await context.cookies()).some((c) => c.name === 'nardy_guest'));
  const old = await context.request.get(base + '/api/profile', { headers: { Cookie: `nardy_guest=${profileCookie.value}` } });
  assert.equal((await old.json()).profile, null);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('privacy: RU/EN routes, mobile layout, CSP, export, deletion, cancellation and failure recovery passed');
})().catch((e) => { console.error(e); process.exit(1); });
