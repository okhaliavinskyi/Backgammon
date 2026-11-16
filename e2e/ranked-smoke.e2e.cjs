// Uses only fresh QA profiles, verifies both are paired together before entering,
// and deletes those profiles afterwards. Set NARDY_URL explicitly for production.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.env.NARDY_URL || 'http://127.0.0.1:18926';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const contexts = [];
  const errors = [];
  async function getProfile(ctx) {
    const r = await ctx.request.get(BASE + '/api/profile'); assert.equal(r.status(), 200);
    return (await r.json()).profile;
  }
  async function search(ctx, method) {
    const r = await ctx.request.fetch(BASE + '/api/ranked/short', { method, ...(method === 'POST' ? { data: { name: 'QA review' } } : {}) });
    assert.equal(r.status(), 200); return r.json();
  }
  try {
    for (let i = 0; i < 2; i++) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' }); contexts.push(ctx);
      assert.equal((await ctx.request.post(BASE + '/api/profile')).status(), 200);
    }
    const [a,b] = contexts;
    const first = await search(a, 'POST');
    // Do not join a match with a real player if a public queue was already occupied.
    assert.equal(first.status, 'searching', 'Public queue occupied; no QA match was entered');
    const second = await search(b, 'POST');
    assert.equal(second.status, 'matched');
    assert.equal((await search(a, 'GET')).room, second.room, 'QA profiles were not paired together; no match was entered');
    const pages = [];
    for (let i = 0; i < 2; i++) {
      const page = await contexts[i].newPage(); pages.push(page);
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        const Original = window.WebSocket;
        window.WebSocket = class extends Original {
          constructor(url, protocols) {
            super(url, protocols); window.qaSocket = this;
            this.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.t === 'state') window.qaState = m; });
          }
        };
      });
      await page.goto(BASE + '/r/' + second.room);
      const name = page.locator('input[maxlength="20"]');
      await name.fill('QA review ' + (i === 0 ? 'A' : 'B'));
      assert.equal(await page.locator('input[type="email"]').count(), 0);
      await page.locator('form button').click();
    }
    const [pa,pb] = pages;
    for (const p of pages) {
      await p.locator('.board-svg').waitFor();
      await p.waitForFunction(() => !!window.qaState?.match);
      assert.equal(await p.locator('input[maxlength="20"]').count(), 0);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.equal((await getProfile(a)).ratings.short.matches, 0);
    await pa.evaluate(() => window.qaSocket.send(JSON.stringify({ t: 'resign' })));
    for (const p of pages) await p.waitForFunction(() => window.qaState?.room.ranked?.settled);
    const ratedA = await getProfile(a), ratedB = await getProfile(b);
    assert.equal(ratedA.ratings.short.elo, 968); assert.equal(ratedB.ratings.short.elo, 1032);
    assert.equal(ratedA.ratings.short.matches, 1); assert.equal(ratedB.ratings.short.matches, 1);
    assert.equal(ratedA.ratings.long.matches, 0);
    await pa.reload(); await pa.waitForFunction(() => window.qaState?.room.ranked?.settled);
    assert.deepEqual((await getProfile(a)).ratings.short, ratedA.ratings.short);
    // A private link opens directly; the saved name is reused without registration.
    const response = await a.request.post(BASE + '/api/rooms', { data: { name: 'QA review A', settings: { variant: 'long', matchLength: 1, moveTimer: 0, bank: 0, cube: false, isPublic: false } } });
    assert.equal(response.status(), 201); const friend = await response.json();
    await pa.goto(BASE + '/r/' + friend.id); await pa.locator('.code-card').waitFor();
    await pb.goto(pa.url());
    for (const p of pages) {
      await p.locator('.board-svg').waitFor();
      await p.waitForFunction(() => !!window.qaState?.match && !window.qaState.room.ranked);
      assert.equal(await p.locator('input[maxlength="20"]').count(), 0);
    }
    await pa.evaluate(() => window.qaSocket.send(JSON.stringify({ t: 'resign' })));
    await pa.waitForFunction(() => window.qaState?.match.phase === 'matchover');
    assert.deepEqual((await getProfile(a)).ratings.short, ratedA.ratings.short);
    assert.equal((await getProfile(a)).ratings.long.matches, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ url: BASE, ranked: 'pass', guestNameOnly: 'pass', elo: [968,1032], duplicateResult: 'pass', friendLink: 'pass', friendDoesNotChangeElo: 'pass', pageErrors: errors.length }));
  } finally {
    for (const ctx of contexts) {
      for (const page of ctx.pages()) await page.close().catch(() => {});
      await search(ctx, 'DELETE').catch(() => {});
      await ctx.request.delete(BASE + '/api/profile').catch(() => {});
    }
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
