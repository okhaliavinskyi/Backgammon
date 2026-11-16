import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';
import { chooseTurn, levelForXp, xpForLevel, type MatchState, type ProgressProfile } from '@nardy/core';
const BASE = process.env.NARDY_URL ?? 'http://127.0.0.1:18923';

describe('guest progression against local Worker', () => {
  it('level boundaries match published thresholds', () => {
    for (let l = 2; l <= 100; l++) {
      expect(levelForXp(xpForLevel(l))).toBe(l);
      expect(levelForXp(xpForLevel(l) - 1)).toBe(l - 1);
    }
  });
  it('name-only link, authoritative rewards, purchases, privacy and reconnect', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const a = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const b = await browser.newContext();
      const pa = await a.newPage(), pb = await b.newPage();
      const errors: string[] = [];
      for (const page of [pa, pb]) page.on('pageerror', e => errors.push(e.message));
      await pa.goto(BASE); await pb.goto(BASE);
      const created = await a.request.post(BASE + '/api/rooms', { data: { settings: { variant: 'short', matchLength: 1, cube: false, moveTimer: 0, bank: 0, isPublic: false } } });
      expect(created.status()).toBe(201);
      const { id } = await created.json();
      // Link opens directly, with only the name missing.
      await pa.goto(BASE + '/r/' + id);
      await pa.locator('input[maxlength="20"]').fill('Alice');
      await pa.locator('form button').click();
      await pa.waitForFunction(() => localStorage.getItem('nardy.token.' + location.pathname.split('/').pop()));
      await pb.goto(BASE + '/r/' + id);
      await pb.locator('input[maxlength="20"]').fill('Bob');
      await pb.locator('form button').click();
      await pb.waitForFunction(() => localStorage.getItem('nardy.token.' + location.pathname.split('/').pop()));
      expect((await a.cookies()).find(c => c.name === 'nardy_guest')?.httpOnly).toBe(true);
      expect(await pa.evaluate(() => document.cookie)).not.toContain('nardy_guest');
      // Replace UI sockets with deterministic action clients, retaining browser cookies.
      for (const page of [pa, pb]) {
        await page.goto(BASE + '/profile');
        await page.evaluate(async room => {
          const win = window as any;
          win.messages = [];
          const ws = new WebSocket(location.origin.replace('http', 'ws') + '/api/rooms/' + room + '/ws');
          win.testWs = ws;
          ws.onmessage = e => { const m = JSON.parse(e.data); win.messages.push(m); if (m.t === 'state') win.state = m; };
          await new Promise<void>(resolve => { ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', name: 'Player', token: localStorage.getItem('nardy.token.' + room) })); resolve(); }; });
        }, id);
        await page.waitForFunction(() => !!(window as any).state?.match);
      }
      let m = await pa.evaluate(() => (window as any).state.match) as MatchState;
      for (let i = 0; i < 1500 && !m.result; i++) {
        const actor = m.turn === 0 ? pa : pb;
        const action = m.phase === 'roll' ? { t: 'roll' } : { t: 'move', steps: chooseTurn(m, 'beginner').map(s => ({ from: s.from, die: s.die })) };
        const seq = m.seq;
        await actor.evaluate(msg => (window as any).testWs.send(JSON.stringify(msg)), action);
        await pa.waitForFunction(seq => (window as any).state.match.seq > seq, seq);
        await pb.waitForFunction(seq => (window as any).state.match.seq > seq, seq);
        m = await pa.evaluate(() => (window as any).state.match);
      }
      expect(m.phase).toBe('matchover');
      const profileA = (await (await a.request.get(BASE + '/api/profile')).json()).profile as ProgressProfile;
      const profileB = (await (await b.request.get(BASE + '/api/profile')).json()).profile as ProgressProfile;
      expect(profileA.xp).toBe(m.result!.winner === 0 ? 200 : 150);
      expect(profileB.xp).toBe(m.result!.winner === 1 ? 200 : 150);
      expect(profileA.coins).toBe(m.result!.winner === 0 ? 160 : 130);
      expect(profileA.stats.short.matches).toBe(1);
      expect(profileA.stats.short.games).toBe(1);
      const buy = await a.request.post(BASE + '/api/profile/purchase', { data: { id: 'fox', price: 0, coins: 99999 } });
      const bought = (await buy.json()).profile as ProgressProfile;
      expect(bought.coins).toBe(profileA.coins - 100);
      const retry = (await (await a.request.post(BASE + '/api/profile/purchase', { data: { id: 'fox' } })).json()).profile;
      expect(retry.coins).toBe(bought.coins);
      expect((await a.request.post(BASE + '/api/profile/equip', { data: { kind: 'theme', id: 'amber-board' } })).status()).toBe(400);
      expect((await a.request.post(BASE + '/api/profile/purchase', { data: { id: 'amber-board' } })).status()).toBe(400);
      await a.request.post(BASE + '/api/profile/equip', { data: { kind: 'avatar', id: 'fox' } });
      await pa.goto(BASE + '/profile');
      await expect.poll(async () => pa.locator('.progress-avatar').first().textContent()).toContain('🦊');
      await pa.getByRole('button', { name: /Лис|Fox/, exact: false }).click();
      await pa.screenshot({ path: '/tmp/nardy-gamification-profile.png', fullPage: true });
      // Reconnection and replayed hello must not duplicate the reward.
      await pb.goto(BASE + '/r/' + id);
      await pb.waitForFunction(() => !!document.querySelector('.res-score'));
      expect(await pb.locator('input[maxlength="20"]').count()).toBe(0);
      expect((await (await b.request.get(BASE + '/api/profile')).json()).profile.coins).toBe(profileB.coins);
      const stranger = await browser.newContext();
      expect((await stranger.request.get(BASE + '/api/profile')).status()).toBe(401);
      expect((await stranger.request.post(BASE + '/api/profile/purchase', { data: { id: 'fox' } })).status()).toBe(401);
      expect((await a.request.post(BASE + '/api/profile/purchase', { headers: { Origin: 'https://evil.test' }, data: { id: 'fox' } })).status()).toBe(403);
      // Continue the same pair past the cap. A short surrender must not consume it.
      for (const page of [pa, pb]) {
        await page.goto(BASE + '/profile');
        await page.evaluate(async room => {
          const win = window as any; win.state = null;
          win.testWs = new WebSocket(location.origin.replace('http', 'ws') + '/api/rooms/' + room + '/ws');
          win.testWs.onmessage = (e: MessageEvent) => { const m = JSON.parse(e.data); if (m.t === 'state') win.state = m; };
          await new Promise<void>(resolve => { win.testWs.onopen = () => { win.testWs.send(JSON.stringify({ t: 'hello', name: 'Player', token: localStorage.getItem('nardy.token.' + room) })); resolve(); }; });
        }, id);
        await page.waitForFunction(() => !!(window as any).state?.match);
      }
      let beforeLast: ProgressProfile | null = null;
      for (let round = 0; round <= 10; round++) {
        if (round === 10) beforeLast = (await (await a.request.get(BASE + '/api/profile')).json()).profile;
        for (const page of [pa, pb]) await page.evaluate(() => (window as any).testWs.send(JSON.stringify({ t: 'rematch' })));
        await pa.waitForFunction(() => (window as any).state?.match && !(window as any).state.match.result);
        await pb.waitForFunction(() => (window as any).state?.match && !(window as any).state.match.result);
        if (round === 0) {
          await pa.evaluate(() => (window as any).testWs.send(JSON.stringify({ t: 'resign' })));
          await pa.waitForFunction(() => !!(window as any).state.match.result);
          await pb.waitForFunction(() => !!(window as any).state.match.result);
          const short = (await (await a.request.get(BASE + '/api/profile')).json()).profile;
          expect(short.lastReward.xp).toBe(0);
          expect(short.lastReward.coins).toBe(0);
          continue;
        }
        m = await pa.evaluate(() => (window as any).state.match);
        for (let i = 0; i < 1500 && !m.result; i++) {
          const actor = m.turn === 0 ? pa : pb, seq = m.seq;
          const action = m.phase === 'roll' ? { t: 'roll' } : { t: 'move', steps: chooseTurn(m, 'beginner').map(s => ({ from: s.from, die: s.die })) };
          await actor.evaluate(msg => (window as any).testWs.send(JSON.stringify(msg)), action);
          await pa.waitForFunction(seq => (window as any).state.match.seq > seq, seq);
          await pb.waitForFunction(seq => (window as any).state.match.seq > seq, seq);
          m = await pa.evaluate(() => (window as any).state.match);
        }
        expect(m.phase).toBe('matchover');
      }
      const capped = (await (await a.request.get(BASE + '/api/profile')).json()).profile as ProgressProfile;
      expect(capped.lastReward?.limited).toBe(true);
      expect(capped.lastReward!.xp).toBeGreaterThanOrEqual(100);
      expect(capped.stats.short.qualified).toBe(11);
      expect(capped.badges).toContain('games-10');
      let levelCoins = 0;
      for (let l = levelForXp(beforeLast!.xp) + 1; l <= levelForXp(capped.xp); l++) levelCoins += 20 + (l % 5 === 0 ? 80 : 0);
      expect(capped.coins - beforeLast!.coins).toBe(levelCoins);
      // A concurrent room cannot farm this profile; its innocent opponent remains eligible.
      for (const page of [pa, pb]) await page.evaluate(() => (window as any).testWs.send(JSON.stringify({ t: 'rematch' })));
      await pa.waitForFunction(() => !(window as any).state.match.result);
      const c = await browser.newContext();
      const otherA = await a.newPage(), pc = await c.newPage();
      for (const page of [otherA, pc]) await page.addInitScript(() => {
        const Native = window.WebSocket;
        (window as any).WebSocket = class extends Native {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols); (window as any).lastWs = this;
            this.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.t === 'state') (window as any).roomState = m; });
          }
        };
      });
      const second = await a.request.post(BASE + '/api/rooms', { data: { settings: { variant: 'short', matchLength: 1, cube: false, moveTimer: 0, bank: 0, isPublic: false } } });
      const secondId = (await second.json()).id;
      await otherA.goto(BASE + '/r/' + secondId);
      await otherA.waitForFunction(() => !!(window as any).roomState);
      await pc.goto(BASE + '/r/' + secondId);
      await pc.locator('input[maxlength="20"]').fill('Charlie');
      await pc.locator('form button').click();
      await otherA.waitForFunction(() => !!(window as any).roomState?.match);
      await pc.waitForFunction(() => !!(window as any).roomState?.match);
      expect(await otherA.evaluate(() => (window as any).roomState.room.progressEligible)).toBe(false);
      expect(await pc.evaluate(() => (window as any).roomState.room.progressEligible)).toBe(true);
      // Leaving the earlier room lets a new match acquire the profile without a 35-minute lockout.
      await pa.close(); await pb.close();
      await otherA.evaluate(() => (window as any).lastWs.send(JSON.stringify({ t: 'resign' })));
      await otherA.waitForFunction(() => !!(window as any).roomState.match.result);
      await pc.waitForFunction(() => !!(window as any).roomState.match.result);
      for (const page of [otherA, pc]) await page.evaluate(() => (window as any).lastWs.send(JSON.stringify({ t: 'rematch' })));
      await otherA.waitForFunction(() => !(window as any).roomState.match.result);
      expect(await otherA.evaluate(() => (window as any).roomState.room.progressEligible)).toBe(true);
      await a.request.delete(BASE + '/api/profile/device');
      expect((await a.request.get(BASE + '/api/profile')).status()).toBe(401);
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }, 120000);
});
