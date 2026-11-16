import { describe, expect, it } from 'vitest';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { chooseTurn, type MatchState } from '@nardy/core';
import { normalizeEmail, sha256, sessionCookie } from '../src/auth-util';
const BASE = process.env.NARDY_URL ?? 'http://127.0.0.1:18927';
const LOG = process.env.NARDY_MAIL_LOG ?? '/tmp/nardy-email-local.log';
async function post(ctx: BrowserContext, path: string, body: object) {
  return ctx.request.post(BASE + '/api/auth/' + path, { data: body });
}
async function profile(ctx: BrowserContext) {
  return (await (await ctx.request.get(BASE + '/api/profile')).json()).profile;
}
async function tokenFor(email: string, not?: string): Promise<string> {
  const key = await sha256(email);
  let found = '';
  await expect
    .poll(
      async () => {
        const log = (await readFile(LOG, 'utf8')).replace(
          /\x1b\[[0-9;]*m/g,
          '',
        );
        for (const m of [...log.matchAll(/Text: ([^\r\n]+)/g)].reverse()) {
          try {
            const text = await readFile(m[1].trim(), 'utf8');
            const token = text.match(
              /\/auth#([a-f0-9]{64}\.[a-f0-9]{64})/,
            )?.[1];
            if (token?.startsWith(key + '.') && token !== not) {
              expect(text).toContain(BASE + '/auth#' + token);
              found = token;
              return true;
            }
          } catch {
            /* Wait for simulator to flush. */
          }
        }
        return false;
      },
      { timeout: 10000, interval: 100 },
    )
    .toBe(true);
  return found;
}
async function socket(page: Page, id: string) {
  await page.goto(BASE + '/');
  await page.evaluate(async ({ id, base }) => {
    const w = window as any;
    w.game = null;
    w.ws = new WebSocket(
      base.replace('http', 'ws') + '/api/rooms/' + id + '/ws',
    );
    w.ws.onmessage = (e: MessageEvent) => {
      const m = JSON.parse(e.data);
      if (m.t === 'state') {
        w.game = m.match;
        w.room = m.room;
      }
      if (m.t === 'welcome') w.roomToken = m.token;
    };
    await new Promise<void>((resolve) => {
      w.ws.onopen = () => {
        w.ws.send(JSON.stringify({ t: 'hello', name: 'Player' }));
        resolve();
      };
    });
  }, { id, base: BASE });
}
describe('email account policy', () => {
  it('normalizes supported email and rejects malformed addresses and session cookies', async () => {
    expect(normalizeEmail(' Alice@Example.COM ')).toBe('alice@example.com');
    expect(normalizeEmail('a@xn--e1afmkfd.xn--p1ai')).toBe(
      'a@xn--e1afmkfd.xn--p1ai',
    );
    for (const input of [
      'a\r\nb@example.com',
      'a..b@example.com',
      'a@b',
      'a@example.com\nBcc:x@bad.test',
      'a@-bad.test',
      'a@x.-bad.test',
      '.a@example.com',
      'a.@example.com',
      null,
    ])
      expect(normalizeEmail(input)).toBeNull();
    expect(
      sessionCookie('nardy_session=' + 'a'.repeat(64) + '.' + 'b'.repeat(64)),
    ).not.toBeNull();
    expect(sessionCookie('nardy_session=bad')).toBeNull();
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('preserves earned guest progress, verifies in the same browser, signs in elsewhere without merging, revokes and deletes', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const a = await browser.newContext({
          extraHTTPHeaders: { 'CF-Connecting-IP': '198.18.5.1' },
        }),
        b = await browser.newContext({
          extraHTTPHeaders: { 'CF-Connecting-IP': '198.18.5.2' },
        }),
        stranger = await browser.newContext();
      for (const ctx of [a, b])
        expect((await ctx.request.post(BASE + '/api/profile')).status()).toBe(
          200,
        );
      const email = `account-${crypto.randomUUID()}@example.test`;
      const configured = (
        await (await a.request.get(BASE + '/api/auth/status')).json()
      ).configured;
      expect(
        configured,
        'Set EMAIL_FROM/AUTH_ORIGIN for local simulated email tests',
      ).toBe(true);
      const pa = await a.newPage(),
        pb = await b.newPage();
      const created = await a.request.post(BASE + '/api/rooms', {
        data: {
          settings: {
            variant: 'short',
            matchLength: 1,
            moveTimer: 0,
            bank: 0,
            cube: false,
            isPublic: false,
          },
        },
      });
      const id = (await created.json()).id;
      await socket(pa, id);
      await socket(pb, id);
      for (const page of [pa, pb])
        await page.waitForFunction(() => !!(window as any).game);
      let m = (await pa.evaluate(() => (window as any).game)) as MatchState;
      for (let i = 0; i < 1500 && !m.result; i++) {
        const action =
          m.phase === 'roll'
            ? { t: 'roll' }
            : {
                t: 'move',
                steps: chooseTurn(m, 'beginner').map((s) => ({
                  from: s.from,
                  die: s.die,
                })),
              };
        await (m.turn === 0 ? pa : pb).evaluate(
          (msg) => (window as any).ws.send(JSON.stringify(msg)),
          action,
        );
        for (const page of [pa, pb])
          await page.waitForFunction(
            (seq) => (window as any).game.seq > seq,
            m.seq,
          );
        m = await pa.evaluate(() => (window as any).game);
      }
      expect(m.phase).toBe('matchover');
      const oldRoomToken = await pa.evaluate(() => (window as any).roomToken);
      await a.request.post(BASE + '/api/ranked/short', {
        data: { name: 'Alice' },
      });
      const match = await (
        await b.request.post(BASE + '/api/ranked/short', {
          data: { name: 'Bob' },
        })
      ).json();
      expect(match.status).toBe('matched');
      expect(
        (await (await a.request.get(BASE + '/api/ranked/short')).json()).room,
      ).toBe(match.room);
      await socket(pa, match.room);
      await socket(pb, match.room);
      for (const page of [pa, pb])
        await page.waitForFunction(() => !!(window as any).game);
      await pa.evaluate(() =>
        (window as any).ws.send(JSON.stringify({ t: 'resign' })),
      );
      for (const page of [pa, pb])
        await page.waitForFunction(() => (window as any).room.ranked.settled);
      expect(
        (
          await a.request.post(BASE + '/api/profile/purchase', {
            data: { id: 'fox' },
          })
        ).status(),
      ).toBe(200);
      await a.request.post(BASE + '/api/profile/equip', {
        data: { kind: 'avatar', id: 'fox' },
      });
      const original = await profile(a),
        otherGuest = await profile(b);
      expect(original.xp).toBeGreaterThan(0);
      expect(otherGuest.xp).toBeGreaterThan(0);
      expect(original.ratings.short).toMatchObject({ elo: 968, matches: 1 });
      const oldGuest = (await a.cookies()).find(
        (c) => c.name === 'nardy_guest',
      )!.value;
      expect(
        (
          await post(a, 'request', { kind: 'bind', email, name: 'Alice' })
        ).status(),
      ).toBe(200);
      const bindToken = await tokenFor(email);
      expect(
        (
          await post(b, 'confirm', { token: bindToken, confirm: true })
        ).status(),
      ).toBe(409);
      expect((await post(a, 'inspect', { token: bindToken })).status()).toBe(
        200,
      );
      await pa.goto(BASE + '/auth#' + bindToken);
      await pa
        .getByRole('button', { name: /Link and save|Привязать и сохранить/ })
        .waitFor();
      expect(pa.url()).not.toContain('#');
      expect((await post(a, 'inspect', { token: bindToken })).status()).toBe(
        200,
      ); // Scanner/preview did not consume it.
      await pa
        .getByRole('button', { name: /Link and save|Привязать и сохранить/ })
        .click();
      await pa.waitForURL('**/profile');
      expect(await profile(a)).toEqual(original);
      expect(
        (await a.cookies()).find((c) => c.name === 'nardy_session')?.httpOnly,
      ).toBe(true);
      expect(
        (await a.cookies()).find((c) => c.name === 'nardy_guest'),
      ).toBeUndefined();
      expect(
        (
          await post(a, 'confirm', { token: bindToken, confirm: true })
        ).status(),
      ).toBe(400);
      expect(
        (
          await stranger.request.get(BASE + '/api/profile', {
            headers: { Cookie: 'nardy_guest=' + oldGuest },
          })
        ).status(),
      ).toBe(401);
      const attack = await stranger.newPage();
      await attack.goto(BASE + '/');
      const reason = await attack.evaluate(
        async ({ id, token, base }) => {
          const ws = new WebSocket(
            base.replace('http', 'ws') + '/api/rooms/' + id + '/ws',
          );
          return new Promise<string>((resolve) => {
            ws.onopen = () =>
              ws.send(
                JSON.stringify({ t: 'hello', name: 'Old seat token', token }),
              );
            ws.onclose = (e) => resolve(e.reason);
          });
        },
        { id, token: oldRoomToken, base: BASE },
      );
      expect(reason).toBe('session_expired');

      expect(
        (await post(b, 'request', { kind: 'login', email })).status(),
      ).toBe(200);
      const loginToken = await tokenFor(email, bindToken);
      const preview = await (
        await post(b, 'inspect', { token: loginToken })
      ).json();
      expect(preview.hasGuestProgress).toBe(true);
      expect(JSON.stringify(preview)).not.toContain(oldGuest);
      await pb.evaluate(() => localStorage.setItem('nardy.settings', JSON.stringify({ state: { name: 'Guest B', lang: 'en', sound: false }, version: 1 })));
      await pb.goto(BASE + '/auth#' + loginToken);
      await pb
        .getByRole('button', {
          name: /Sign in to emailed profile|Войти в профиль из письма/,
        })
        .click();
      await pb.waitForURL('**/profile');
      expect(await profile(b)).toEqual(original);
      const bSession = (await b.cookies()).find(
        (c) => c.name === 'nardy_session',
      )!.value;
      await pb.getByRole('button', { name: 'Sign out on this device', exact: true }).click();
      await pb.locator('.email-account input[type="email"]').waitFor();
      expect(await pb.evaluate(() => JSON.parse(localStorage.getItem('nardy.settings')!).state.name)).toBe('Guest B');
      expect(await profile(b)).toEqual(otherGuest);
      expect(
        (
          await stranger.request.get(BASE + '/api/profile', {
            headers: { Cookie: 'nardy_session=' + bSession },
          })
        ).status(),
      ).toBe(401);
      // A stale account cookie must not prevent valid guest play after logout.
      await b.addCookies([{ name: 'nardy_session', value: bSession, url: BASE, httpOnly: true }]);
      const friend = await (await b.request.post(BASE + '/api/rooms', {data: { settings: { variant: 'short', matchLength: 1, cube: false, moveTimer: 0, bank: 0, isPublic: false } }})).json();
      await socket(pa, friend.id); await socket(pb, friend.id);
      for (const page of [pa,pb]) await page.waitForFunction(() => !!(window as any).game);
      await pb.evaluate(() => (window as any).ws.send(JSON.stringify({t:'resign'})));
      await pb.waitForFunction(() => (window as any).game?.phase === 'matchover');
      const aSession = (await a.cookies()).find(
        (c) => c.name === 'nardy_session',
      )!.value;
      expect((await a.request.delete(BASE + '/api/profile')).status()).toBe(
        204,
      );
      expect(
        (
          await stranger.request.get(BASE + '/api/profile', {
            headers: { Cookie: 'nardy_session=' + aSession },
          })
        ).status(),
      ).toBe(401);
      expect(
        (
          await post(stranger, 'confirm', { token: loginToken, confirm: true })
        ).status(),
      ).toBe(400);
      expect(
        (
          await post(b, 'request', {
            kind: 'login',
            email: 'nobody-' + crypto.randomUUID() + '@example.test',
          })
        ).status(),
      ).toBe(200);
    } finally {
      await browser.close();
    }
  }, 90000);
});
