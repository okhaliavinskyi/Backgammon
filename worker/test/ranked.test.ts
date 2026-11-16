import { describe, it, expect } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { chooseTurn, type MatchState } from '@nardy/core';
const BASE = process.env.NARDY_URL ?? 'http://127.0.0.1:18925';
let contextId = 0;
// Independent simulated edge IPs keep load-test traffic from exhausting another suite's quota.
const context = (browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) => browser.newContext({ ...options, extraHTTPHeaders: { ...options.extraHTTPHeaders, 'CF-Connecting-IP': `198.18.2.${++contextId}` } });
async function profile(ctx: BrowserContext) {
  const r = await ctx.request.post(BASE + '/api/profile'); expect(r.ok()).toBe(true);
  return (await r.json()).profile;
}
async function search(ctx: BrowserContext, method = 'POST', variant = 'short') {
  const r = await ctx.request.fetch(BASE + '/api/ranked/' + variant, { method, ...(method === 'POST' ? { data: { name: 'Guest' } } : {}) });
  expect(r.ok()).toBe(true); return r.json();
}
async function connect(page: Page, room: string) {
  await page.goto(BASE + '/profile');
  await page.evaluate(async room => {
    const w = window as any; w.state = null; w.wsClosed = null;
    const ws = new WebSocket(location.origin.replace('http','ws') + '/api/rooms/' + room + '/ws'); w.ws = ws;
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'state') w.state = m; };
    ws.onclose = e => { w.wsClosed = e.reason; };
    await new Promise<void>(resolve => { ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', name: 'Guest' })); resolve(); }; });
  }, room);
}
async function send(page: Page, action: object) { await page.evaluate(msg => (window as any).ws.send(JSON.stringify(msg)), action); }
async function waitStarted(page: Page) { await page.waitForFunction(() => !!(window as any).state?.match); }
async function finishParty(a: Page, b: Page): Promise<MatchState> {
  let m = await a.evaluate(() => (window as any).state.match) as MatchState;
  for (let i = 0; i < 2000 && !m.result; i++) {
    const action = m.phase === 'roll' ? { t: 'roll' } : m.phase === 'cube' ? { t: 'take' } : { t: 'move', steps: chooseTurn(m, 'beginner').map(s => ({ from: s.from, die: s.die })) };
    await send(m.phase === 'cube' ? (m.cubeOfferedBy === 0 ? b : a) : m.turn === 0 ? a : b, action);
    await a.waitForFunction(seq => (window as any).state.match.seq > seq, m.seq);
    await b.waitForFunction(seq => (window as any).state.match.seq > seq, m.seq);
    m = await a.evaluate(() => (window as any).state.match);
  }
  return m;
}

describe('ranked matchmaking, browser guests', () => {
  it('matches guests, prevents intrusion and parallel queues, rates once per match, calibrates and preserves friend rooms', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const a = await context(browser), b = await context(browser), c = await context(browser);
      const pa = await a.newPage(), pb = await b.newPage(), pc = await c.newPage();
      const errors: string[] = []; for (const p of [pa,pb,pc]) p.on('pageerror', e => errors.push(e.message));
      await profile(a); await profile(b); await profile(c);
      expect((await c.request.post(BASE + '/api/ranked/short', { headers: { Origin: 'https://evil.test' }, data: { name: 'X' } })).status()).toBe(403);
      expect((await search(a)).status).toBe('searching');
      expect((await search(a, 'POST', 'long')).status).toBe('busy');
      expect((await search(a, 'DELETE')).status).toBe('idle');
      expect((await search(a, 'GET')).status).toBe('idle');
      await search(a); const matched = await search(b);
      expect(matched.status).toBe('matched');
      const id = matched.room;
      expect((await search(a, 'GET')).room).toBe(id);
      expect((await search(a, 'DELETE')).room).toBe(id); // A committed pairing cannot be cancelled into a second match.
      await connect(pc, id);
      await pc.waitForFunction(() => !!(window as any).wsClosed);
      expect(await pc.evaluate(() => (window as any).wsClosed)).toBe('not_invited');
      await connect(pa,id); await connect(pb,id); await waitStarted(pa); await waitStarted(pb);
      const settings = await pa.evaluate(() => (window as any).state.room.settings);
      expect(settings).toMatchObject({ matchLength: 3, moveTimer: 15, bank: 300, cube: true, isPublic: false });
      // Natural party gives XP, but cannot update Elo before the match is over.
      const party = await finishParty(pa,pb);
      if (party.phase === 'gameover') {
        expect((await (await a.request.get(BASE + '/api/profile')).json()).profile.ratings.short.matches).toBe(0);
        await pa.waitForFunction(() => (window as any).state.match.phase !== 'gameover');
        await pb.waitForFunction(() => (window as any).state.match.phase !== 'gameover');
        await send(pa,{ t: 'resign' });
      }
      await pa.waitForFunction(() => (window as any).state?.room.ranked.settled);
      await pb.waitForFunction(() => (window as any).state?.room.ranked.settled);
      let pA = (await (await a.request.get(BASE + '/api/profile')).json()).profile;
      expect(pA.ratings.short.matches).toBe(1); expect(Math.abs(pA.ratings.short.elo - 1000)).toBe(32);
      expect(pA.ratings.long.elo).toBe(1000); expect(pA.ratings.long.matches).toBe(0);
      const coins = pA.coins, rating = pA.ratings.short.elo;
      await connect(pa,id); await waitStarted(pa);
      expect((await (await a.request.get(BASE + '/api/profile')).json()).profile.ratings.short.elo).toBe(rating);
      expect((await (await a.request.get(BASE + '/api/profile')).json()).profile.coins).toBe(coins);
      // There is no 30-minute ban: the only available pair can meet again.
      for (let round = 1; round < 10; round++) {
        await send(pa, { t: 'ping' });
        await search(a); const found = await search(b); expect(found.status).toBe('matched');
        await connect(pa,found.room); await connect(pb,found.room); await waitStarted(pa); await waitStarted(pb);
        const before = (await (await a.request.get(BASE + '/api/profile')).json()).profile.ratings.short.elo;
        await send(before < 1000 ? pb : pa,{ t: 'resign' });
        await pa.waitForFunction(() => (window as any).state.room.ranked.settled);
        await pb.waitForFunction(() => (window as any).state.room.ranked.settled);
      }
      pA = (await (await a.request.get(BASE + '/api/profile')).json()).profile;
      expect(pA.ratings.short.matches).toBe(10); expect(pA.ratings.short.best).not.toBeNull();
      expect(pA.ratings.long.matches).toBe(0);
      // Ordinary invitation retains its configurable rules and never updates ratings.
      const created = await a.request.post(BASE + '/api/rooms', { data: { settings: { variant: 'short', matchLength: 1, moveTimer: 0, bank: 0, isPublic: false }, name: 'A' } });
      const friendId = (await created.json()).id;
      await connect(pa,friendId); await connect(pb,friendId); await waitStarted(pa); await waitStarted(pb);
      expect(await pa.evaluate(() => (window as any).state.room.ranked)).toBeUndefined();
      await send(pa,{ t: 'resign' });
      await pa.waitForFunction(() => (window as any).state.match.phase === 'matchover');
      expect((await (await a.request.get(BASE + '/api/profile')).json()).profile.ratings.short).toEqual(pA.ratings.short);
      await pa.goto(BASE + '/profile');
      await pa.getByRole('heading', { name: /Ratings|Рейтинг/, exact: true }).waitFor();
      await pa.screenshot({ path: '/tmp/nardy-ranked-profile.png', fullPage: true });
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }, 120000);
  it('cancels a committed no-show without Elo and releases both profiles', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const a = await context(browser), b = await context(browser);
      await profile(a); await profile(b);
      await search(a); const match = await search(b);
      const page = await a.newPage(); await connect(page, match.room);
      await expect.poll(async () => (await (await a.request.get(BASE + '/api/rooms/' + match.room)).json()).cancelled, { timeout: 70000, interval: 3000 }).toBe(true);
      for (const ctx of [a,b]) {
        const p = (await (await ctx.request.get(BASE + '/api/profile')).json()).profile;
        expect(p.ratings.short.matches).toBe(0); expect(p.ratings.short.elo).toBe(1000);
        expect((await search(ctx,'GET')).status).toBe('idle');
      }
      await search(a); expect((await search(b)).status).toBe('matched');
    } finally { await browser.close(); }
  }, 90000);

  it('runs the name-only ranked screen, cancellation and automatic room navigation', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const a = await context(browser, { viewport: { width: 390, height: 844 } }), b = await context(browser);
      const pa = await a.newPage(), pb = await b.newPage();
      for (const [page,name] of [[pa,'Alice'],[pb,'Bob']] as const) {
        await page.goto(BASE + '/ranked');
        await page.locator('input[maxlength="20"]').fill(name);
      }
      await pa.getByRole('button', { name: /Find opponent|Найти соперника/, exact: true }).click();
      await pa.getByRole('button', { name: /Cancel search|Отменить поиск/, exact: true }).waitFor();
      await pa.getByRole('button', { name: /Cancel search|Отменить поиск/, exact: true }).click();
      await pa.getByRole('button', { name: /Find opponent|Найти соперника/, exact: true }).waitFor();
      await pa.getByRole('button', { name: /Find opponent|Найти соперника/, exact: true }).click();
      await pa.getByRole('button', { name: /Cancel search|Отменить поиск/, exact: true }).waitFor();
      await pa.screenshot({ path: '/tmp/nardy-ranked-search-mobile.png', fullPage: true });
      expect(await pa.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await pb.getByRole('button', { name: /Find opponent|Найти соперника/, exact: true }).click();
      await pa.waitForURL(/\/r\//); await pb.waitForURL(/\/r\//);
      expect(new URL(pa.url()).pathname).toBe(new URL(pb.url()).pathname);
      await pa.locator('.board-svg').waitFor(); await pb.locator('.board-svg').waitFor();
      expect(await pa.locator('input[maxlength="20"]').count()).toBe(0);
      await pa.screenshot({ path: '/tmp/nardy-ranked-game-mobile.png', fullPage: true });
    } finally { await browser.close(); }
  }, 30000);

  it('automatically forfeits a disconnected ranked player after the real reconnect window', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const a = await context(browser), b = await context(browser);
      await profile(a); await profile(b); await search(a); const match = await search(b);
      const pa = await a.newPage(), pb = await b.newPage();
      await connect(pa, match.room); await connect(pb, match.room); await waitStarted(pa); await waitStarted(pb);
      await pa.close();
      await pb.waitForFunction(() => (window as any).state?.match?.phase === 'matchover' && (window as any).state.room.ranked.settled, undefined, { timeout: 135000 });
      const pA = (await (await a.request.get(BASE + '/api/profile')).json()).profile;
      const pB = (await (await b.request.get(BASE + '/api/profile')).json()).profile;
      expect(pA.ratings.short).toMatchObject({ matches: 1, losses: 1, elo: 968 });
      expect(pB.ratings.short).toMatchObject({ matches: 1, wins: 1, elo: 1032 });
      expect(pA.xp).toBe(0); expect(pB.xp).toBe(0);
    } finally { await browser.close(); }
  }, 150000);

  it('lets a guest leave for a friend game when matchmaking cancellation is unavailable', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await context(browser), page = await ctx.newPage();
      await page.goto(BASE + '/ranked');
      await page.locator('input[maxlength="20"]').fill('Guest');
      await page.getByRole('button', { name: /Find opponent|Найти соперника/, exact: true }).click();
      await page.getByRole('button', { name: /Cancel search|Отменить поиск/, exact: true }).waitFor();
      await page.route('**/api/ranked/long', route => route.request().method() === 'DELETE'
        ? route.fulfill({ status: 503, json: { error: 'matchmaking_unavailable' } }) : route.continue());
      await page.getByRole('button', { name: /Play a friend|Играть с другом/, exact: true }).click();
      await page.waitForURL(/\/online$/);
      expect(await page.locator('input[type="email"]').count()).toBe(0);
    } finally { await browser.close(); }
  }, 30000);

});
