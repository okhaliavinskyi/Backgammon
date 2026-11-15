// e2e/hud.e2e.cjs — local-mode game (no server state needed beyond static app). Exit code is the script's own.
const { chromium } = require('playwright');
const BASE = process.env.NARDY_URL || 'http://127.0.0.1:8787';
const BAD = [];
const num = (s) => parseInt((s.match(/\d+/) || ['-1'])[0], 10);
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  for (const [w, h, locale] of [[360, 780, 'ru-RU'], [360, 780, 'en-US'], [1440, 900, 'ru-RU']]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, locale })).newPage();
    const L = `${w} ${locale}`;
    await p.goto(BASE + '/play?mode=local&variant=long&len=1'); await p.waitForSelector('.board-wrap');
    const n = await p.locator('.strip').count();
    if (n !== 2) BAD.push(`${L}: found ${n} ".strip", expected 2`);
    else {
      const r = await p.evaluate(() => {
        const R = (s, i = 0) => document.querySelectorAll(s)[i]?.getBoundingClientRect();
        const board = R('.board-wrap'), a = R('.strip', 0), c = R('.strip', 1);
        const small = [...document.querySelectorAll('.action-bar button, .strip button, .game-top button')]
          .map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width && r.height && (r.height < 44 || r.width < 44))
          .map(([e, r]) => `${Math.round(r.width)}x${Math.round(r.height)} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20)}"`);
        return { board: { top: board.top, bottom: board.bottom }, a: { top: a.top, bottom: a.bottom }, c: { top: c.top, bottom: c.bottom },
          turnNow: document.querySelectorAll('.turn-now').length, status: document.querySelectorAll('.status').length,
          pm: [...document.querySelectorAll('.pmeta')].map((e) => e.textContent), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          small, undoDisabled: [...document.querySelectorAll('.action-bar button')].find((e) => /Отменить|Undo/.test(e.textContent))?.disabled };
      });
      if (w < 900) {
        if (!(r.a.bottom <= r.board.top + 1)) BAD.push(`${L}: opponent strip bottom ${Math.round(r.a.bottom)} not above board top ${Math.round(r.board.top)}`);
        const gap = Math.round(r.c.top - r.board.bottom);
        if (gap > 16) BAD.push(`${L}: gap board→own strip = ${gap}px (max 16)`);
      } else {
        const gap = Math.round(r.c.top - r.a.bottom);
        if (gap > 24) BAD.push(`${L}: gap opponent→own strip = ${gap}px (max 24)`);
        if ((await p.locator('.game.desk2').count()) !== 1) BAD.push(`${L}: found 0 ".game.desk2", expected 1`);
        if (!/\d+\s*:\s*\d+/.test((await p.locator('.desk-score').first().textContent().catch(() => '')) || '')) BAD.push(`${L}: ".desk-score" has no score`);
      }
      if (r.turnNow !== 1) BAD.push(`${L}: found ${r.turnNow} ".turn-now", expected 1`);
      if (r.status !== 1) BAD.push(`${L}: found ${r.status} ".status", expected 1`);
      if (r.overflow > 0) BAD.push(`${L}: horizontal overflow ${r.overflow}px`);
      for (const s of r.small) BAD.push(`${L}: tap target ${s}`);
      if (r.undoDisabled !== true) BAD.push(`${L}: Undo should be disabled before the first move, got ${r.undoDisabled}`);
      const [pa, pc] = r.pm.map(num), diff = Math.abs(pa - pc);
      const labels = await p.locator('.pdiff').allTextContents();
      const ahead = labels.filter((t) => /впереди|ahead/.test(t)).length, even = labels.filter((t) => /равны|even/.test(t)).length;
      if (diff === 0 ? even !== 2 : ahead !== 1) BAD.push(`${L}: pips ${pa}/${pc}: found ahead=${ahead} even=${even}`);
    }
    await p.close();
  }
  await b.close();
  console.log(BAD.length ? BAD.join('\n') : 'hud gate: 0 offenders'); console.log(`offenders=${BAD.length}`);
  process.exit(BAD.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

