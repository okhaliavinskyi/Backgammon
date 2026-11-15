// Visual/behavior acceptance matrix. Run against one local wrangler server.
const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path'),
  os = require('os');
const BASE = process.env.NARDY_URL || 'http://127.0.0.1:8787';
const OUT = process.env.IMPL_SCREEN_DIR || 'docs/design/impl-screens';
const ERR = [];
const assert = (v, m) => {
  if (!v) throw Error(m);
};
const rooms = Array.from({ length: 6 }, (_, i) => ({
  id: 'MOCK0' + i,
  host: ['Marta', 'Алексей', 'Ника', 'Борис', 'Ира', 'Лев'][i],
  hasPassword: i % 2 === 0,
  settings: { variant: i % 2 ? 'long' : 'short', matchLength: 3, moveTimer: 30, bank: 600, cube: i % 2 === 0 },
}));
async function create(password = '', isPublic = false) {
  const r = await fetch(BASE + '/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'QA',
      password,
      settings: { variant: 'short', matchLength: 3, moveTimer: 30, bank: 600, cube: true, isPublic },
    }),
  });
  assert(r.ok, 'create ' + r.status);
  return (await r.json()).id;
}
function observe(p) {
  p.on('pageerror', (e) => ERR.push(String(e)));
  p.on('console', (m) => {
    if (m.type() === 'error') ERR.push(m.text());
  });
}
async function snap(p, screen, w, theme) {
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `${screen}/${w}/${theme} overflow`,
  );
  await p.screenshot({ path: path.join(OUT, `redesign-${screen}-${w}-${theme}.png`), fullPage: false });
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nardy-redesign-'));
  require('child_process').execFileSync(path.resolve('node_modules/.bin/esbuild'), [
    'packages/core/src/index.ts',
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--outfile=' + path.join(tmp, 'core.mjs'),
  ]);
  const core = await import('file://' + path.join(tmp, 'core.mjs'));
  let n = 0;
  const match = core.newMatch({ variant: 'short', matchLength: 3, cube: true }, () => [6, 1][n++ % 2]);
  const b = await chromium.launch({ channel: 'chrome' });
  try {
    for (const theme of ['wood', 'minimal', 'malachite'])
      for (const [width, height] of [
        [360, 780],
        [768, 1024],
        [1440, 900],
      ]) {
        const ctx = await b.newContext({
          viewport: { width, height },
          locale: 'ru-RU',
          permissions: ['clipboard-read', 'clipboard-write'],
        });
        await ctx.addInitScript(
          ({ theme, match }) => {
            localStorage.setItem(
              'nardy.settings',
              JSON.stringify({
                version: 1,
                state: {
                  name: 'QA',
                  lang: 'ru',
                  theme,
                  sound: false,
                  speed: 'instant',
                  autoRoll: false,
                  autoConfirm: true,
                  hints: true,
                  shake: false,
                  vibration: false,
                },
              }),
            );
            localStorage.setItem(
              'nardy.aiGame',
              JSON.stringify({ match, level: 'beginner', names: ['QA', 'Opponent'] }),
            );
          },
          { theme, match },
        );
        const p = await ctx.newPage();
        observe(p);
        await p.route('**/api/rooms', (r) =>
          r.request().method() === 'GET' ? r.fulfill({ json: { rooms } }) : r.continue(),
        );
        await p.goto(BASE + '/');
        await p.locator('.resume-card').waitFor();
        console.log(
          'primary contrast',
          theme,
          await p.evaluate(() => {
            const rgb = (h) => {
              h = h.trim();
              return [1, 3, 5]
                .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
                .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
            };
            const lum = (h) => rgb(h).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
            const bg = getComputedStyle(document.documentElement).getPropertyValue('--accent');
            const a = lum(bg),
              z = lum('#1a0d06');
            const ratio = (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05);
            if (ratio < 4.5) throw Error('primary contrast ' + ratio);
            return ratio.toFixed(2);
          }),
        );
        assert((await p.locator('.menu-row.primary').count()) === 1, 'gold row count');
        await snap(p, 'home', width, theme);
        await p.locator('.resume-card').click();
        await p.waitForSelector('.board-svg');
        console.log('resume works', width, theme);
        await p.goto(BASE + '/ai');
        await snap(p, 'setup', width, theme);
        if (width === 360) {
          await p.locator('.name-chip').click();
          await p.locator('.name-input').fill('WWWWWWWWWWWWWWWWWWWW');
          await p.locator('.name-input').press('Enter');
          await snap(p, 'setup-long-name', width, theme);
        }
        await p.goto(BASE + '/online');
        await p.locator('.room-card2').last().waitFor();
        await snap(p, 'lobby', width, theme);
        await p.evaluate(() => scrollTo(0, document.body.scrollHeight));
        const g = await p.evaluate(() => ({
          last: [...document.querySelectorAll('.room-card2')].at(-1).getBoundingClientRect().bottom,
          bar: document.querySelector('.lobby-bar').getBoundingClientRect().top,
        }));
        assert(g.last <= g.bar, `last lobby card covered ${JSON.stringify(g)}`);
        await snap(p, 'lobby-bottom', width, theme);
        await p.getByRole('radio', { name: 'Длинные', exact: true }).click();
        assert((await p.locator('.room-card2').count()) === 3, 'long filter');
        if (width === 360) {
          await p.locator('.name-chip').click();
          await p.locator('.name-input').fill('WWWWWWWWWWWWWWWWWWWW');
          await p.locator('.name-input').press('Enter');
          await snap(p, 'lobby-long-name', width, theme);
        }
        const id = await create();
        await p.goto(BASE + '/r/' + id);
        await p.locator('.wait2 .params').waitFor();
        await snap(p, 'waiting', width, theme);
        await p.getByRole('button', { name: 'Скопировать ссылку', exact: true }).click();
        await p.getByRole('button', { name: 'Скопировано!', exact: true }).waitFor();
        assert((await p.evaluate(() => navigator.clipboard.readText())) === BASE + '/r/' + id, 'clipboard link');
        await p.goto(BASE + '/settings');
        await snap(p, 'settings-page', width, theme);
        await p.goto(BASE + '/play?resume=1');
        await p.locator('[data-hint="movable"]').first().waitFor();
        const ring = p.locator('[data-hint="movable"]').first();
        const bb = await ring.boundingBox();
        await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await p.locator('[data-hint="target"]').first().waitFor();
        assert((await p.locator('[data-hint="selected"]').count()) === 1, 'selected');
        await snap(p, 'game', width, theme);
        if (width === 768)
          assert(
            (await p.locator('.pbar').count()) === 2 && (await p.locator('.strip').count()) === 0,
            'legacy 768 changed',
          );
        else {
          assert((await p.locator('.strip').count()) === 2, 'strips absent');
          await p.getByRole('button', { name: 'Реакции', exact: true }).click();
          assert((await p.getByRole('menuitem').count()) >= 6, 'reaction palette');
          await snap(p, 'reactions', width, theme);
          await p.getByRole('menuitem').last().click();
          await p.getByRole('button', { name: 'Ещё', exact: true }).click();
          await p.getByRole('button', { name: 'Сдаться', exact: true }).click();
          await p.getByText('Сдать партию?', { exact: true }).waitFor();
          await p.getByRole('button', { name: 'Нет', exact: true }).click();
        }
        await ctx.close();
        console.log('matrix', width, theme, 'OK');
      }
    // Password/error branches in both locales, including permission UI available on iOS.
    for (const locale of ['ru-RU', 'en-US']) {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, locale, isMobile: true, hasTouch: true });
      await ctx.addInitScript(() => {
        Object.defineProperty(DeviceMotionEvent, 'requestPermission', {
          configurable: true,
          value: async () => 'granted',
        });
      });
      const p = await ctx.newPage();
      observe(p);
      const id = await create('42');
      await p.goto(BASE + '/r/' + id);
      await p.locator('input[type=password]').waitFor();
      await snap(p, 'password-' + locale, 360, 'wood');
      assert(!/\p{Extended_Pictographic}/u.test(await p.locator('h2').innerText()), 'password emoji');
      await p.goto(BASE + '/r/ZZZZZZ');
      await p.locator('.empty-ico').waitFor();
      await snap(p, 'not-found-' + locale, 360, 'wood');
      await p.goto(BASE + '/settings');
      const permission = p.getByRole('button', { name: locale === 'ru-RU' ? 'Включить встряхивание' : 'Enable shake' });
      await permission.waitFor();
      assert(!/\p{Extended_Pictographic}/u.test(await permission.innerText()), 'motion emoji');
      await permission.click();
      await p.waitForTimeout(50);
      await snap(p, 'motion-' + locale, 360, 'wood');
      await ctx.close();
    }
    // Check the lobby visibility pill against the server state in both directions.
    for (const isPublic of [true, false]) {
      const id = await create('', isPublic);
      const c = await b.newContext({ locale: 'ru-RU' });
      const p = await c.newPage();
      observe(p);
      await p.goto(BASE + '/r/' + id);
      await p.locator('.status-pill').waitFor();
      assert(
        (await p.locator('.status-pill').innerText()) === (isPublic ? 'Видна в лобби' : 'Только по ссылке'),
        'visibility pill',
      );
      await c.close();
    }
    // Actual online wide chat geometry, not just a fixture or local mode.
    const id = await create();
    const ps = [];
    for (const name of ['Online A', 'Online B']) {
      const c = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
      await c.addInitScript(
        (name) =>
          localStorage.setItem(
            'nardy.settings',
            JSON.stringify({
              version: 1,
              state: {
                name,
                lang: 'ru',
                sound: false,
                speed: 'instant',
                autoRoll: false,
                autoConfirm: true,
                vibration: false,
              },
            }),
          ),
        name,
      );
      const p = await c.newPage();
      observe(p);
      await p.goto(BASE + '/r/' + id);
      ps.push(p);
    }
    for (const p of ps) await p.locator('.board-svg').waitFor();
    const p = ps[0];
    const g = await p.evaluate(() => {
      const r = (s) => {
        const x = document.querySelector(s).getBoundingClientRect();
        return { top: x.top, bottom: x.bottom };
      };
      return { opp: r('.area-opp'), chat: r('.chat'), own: r('.mobile-hud') };
    });
    assert(g.chat.top >= g.opp.bottom && g.chat.bottom <= g.own.top, 'online chat geometry ' + JSON.stringify(g));
    await p.locator('.chat-form input').fill('Проверка чата');
    await p.locator('.chat-form button').click();
    await ps[1].getByText('Проверка чата', { exact: true }).waitFor();
    await p.getByText('Проверка чата', { exact: true }).waitFor();
    console.log('chat line rect', await p.getByText('Проверка чата', { exact: true }).boundingBox());
    await snap(p, 'online-game', 1440, 'wood');
    for (const p of ps) await p.context().close();
    console.log('online chat geometry', g);
    assert(ERR.length === 0, 'console/page errors ' + ERR.join('\n'));
    console.log('redesign matrix: OK, console errors=0');
  } finally {
    await b.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
