// e2e/screens.e2e.cjs  — NODE_PATH/NARDY_URL as in plan; exit code is the script's own.
const { chromium } = require('playwright');
const BASE = process.env.NARDY_URL || 'http://127.0.0.1:8787';
const WIDTHS = [360, 768, 1440];
const LOCALES = ['ru-RU', 'en-US'];
const EMOJI = /\p{Extended_Pictographic}/u;
const BAD = [];
const room = (i) => ({
  id: 'AAA00' + i,
  host: ['Marta', 'Алексей', 'Ника', 'Борис', 'Ира', 'Лев'][i],
  hasPassword: i % 2 === 0,
  createdAt: Date.now(),
  settings: {
    variant: i % 2 ? 'long' : 'short',
    matchLength: 3,
    moveTimer: 30,
    bank: 600,
    cube: i % 2 === 0,
    isPublic: true,
  },
});

async function audit(p, label, expectCounts) {
  const out = await p.evaluate(
    ({ src }) => {
      const re = new RegExp(src, 'u'),
        o = [];
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw)
        o.push(`overflow-x: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
      for (const el of document.querySelectorAll('button, a, h1, h2, h3, summary, label')) {
        const t = (el.textContent || '').trim();
        if (re.test(t)) o.push(`emoji in <${el.tagName.toLowerCase()}>: "${t.slice(0, 30)}"`);
      }
      for (const el of document.querySelectorAll(
        'button, a[href], summary, input[type=checkbox], input[role=switch]',
      )) {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        if (b.height < 44 && b.width < 44)
          o.push(
            `tap target ${Math.round(b.width)}x${Math.round(b.height)}: "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`,
          );
        else if (b.height < 44 && el.tagName !== 'INPUT')
          o.push(
            `tap height ${Math.round(b.height)}: "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`,
          );
      }
      return o;
    },
    { src: EMOJI.source },
  );
  for (const f of out) BAD.push(`${label}: ${f}`);
  for (const [sel, n] of Object.entries(expectCounts || {})) {
    const got = await p.locator(sel).count();
    if (got !== n) BAD.push(`${label}: found ${got} "${sel}", expected ${n}`);
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const locale of LOCALES)
    for (const w of WIDTHS) {
      // Each context needs its own room; sharing one starts a match on context #2.
      const created = await (
        await fetch(BASE + '/api/rooms', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            settings: { variant: 'long', matchLength: 3, moveTimer: 30, bank: 600, cube: false, isPublic: false },
            password: '',
            name: 'Gate',
          }),
        })
      ).json();
      if (!created.id) throw new Error('room creation failed: ' + JSON.stringify(created));
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, locale });
      const p = await ctx.newPage();
      await p.route('**/api/rooms', (r) =>
        r.request().method() === 'GET' ? r.fulfill({ json: { rooms: [0, 1, 2, 3, 4, 5].map(room) } }) : r.continue(),
      );
      const L = (r) => `${w} ${locale} ${r}`;
      await p.goto(BASE + '/');
      await p.locator('#root > *').waitFor();
      await audit(p, L('/'), { '.menu-row': 5, '.menu-row.primary': 1, '.home2-head .icon-btn': 1 });
      for (const r of ['/ai', '/local']) {
        await p.goto(BASE + r);
        await p.locator('#root > *').waitFor();
        await audit(p, L(r), { '.variant-card': 2, '.name-chip': 1, '.bottom-bar .btn.primary': 1, '.switch-row': 1 });
      }
      await p.goto(BASE + '/online');
      await p.locator('#root > *').waitFor();
      await p.locator('.room-card2').first().waitFor();
      await audit(p, L('/online'), {
        '.room-card2': 6,
        '.lobby-filter [role=radio]': 3,
        '.lobby-bar form': 1,
        '.name-chip': 1,
      });
      await p.goto(BASE + '/create');
      await p.locator('#root > *').waitFor();
      await audit(p, L('/create'), { '.variant-card': 2 });
      await p.goto(BASE + '/settings');
      await p.locator('#root > *').waitFor();
      await audit(p, L('/settings'), {});
      await p.goto(BASE + '/r/' + created.id);
      await p.locator('input[maxlength="20"]').fill('Gate');
      await p.locator('form button').click();
      await p.waitForSelector('.wait2 .params', { timeout: 8000 });
      await audit(p, L('/r/:id'), { '.code-card': 1, '.params > div': 4, '.wait2 .btn.primary': 1 });
      await ctx.close();
    }
  await browser.close();
  console.log(BAD.length ? BAD.join('\n') : 'screens gate: 0 offenders');
  console.log(`offenders=${BAD.length}`);
  process.exit(BAD.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
