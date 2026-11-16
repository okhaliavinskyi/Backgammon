// Stage N: nardy mounted under /backgammon/ (client, API, manifest, service worker, CSP).
// Usage: NODE_PATH=$HOME/.npm/_npx/9833c18b2d85bc59/node_modules NARDY_URL=http://127.0.0.1:8787 node e2e/mounted.e2e.cjs
// NARDY_URL is the origin WITHOUT /backgammon. SHOT_DIR=<dir> also saves home/play screenshots per width.
// Exit code is this script's own: 1 on any failure or any page/console error, else 0.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const origin = (process.env.NARDY_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const SHOT_DIR = process.env.SHOT_DIR;
const WIDTHS = [360, 768, 1440];
const failures = []; // assert failures, named by path/width
const pageErrors = []; // pageerror + console error/warning, named by width

// Guest profile read answers 401 by design (same filter as online.e2e.cjs).
// Favicon: pages declare no favicon route guarantee, so a /favicon.ico 404 is not a mounting bug.
// vibrate: Chrome warns on navigator.vibrate without a user gesture.
// AudioContext: Chrome autoplay policy warning before a user gesture (the AI board starts sounds on load).
// Root 401: after the portal-back click this origin's "/" is the standalone client (no portal in this run),
// whose guest profile read answers 401 on /api/profile.
// Not filtered on purpose: CSP violations (console error) and any other failed resource.
const expected = (m) => {
  const t = m.text();
  const u = m.location().url || '';
  return (
    t.includes('vibrate') ||
    t.includes('The AudioContext was not allowed to start') ||
    u.endsWith('/favicon.ico') ||
    (t.includes('401 (Unauthorized)') && (u === origin + '/backgammon/api/profile' || u === origin + '/api/profile'))
  );
};

// Run one named step; a failure is recorded with its label and the run continues.
async function step(label, fn) {
  try {
    await fn();
  } catch (e) {
    failures.push(`${label}: ${String(e && e.message || e).split('\n')[0]}`);
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of WIDTHS) {
      const tag = `w${width}`;
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        ...(width < 768 ? { isMobile: true, hasTouch: true } : {}),
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => pageErrors.push(`${tag} pageerror: ${e.message}`));
      page.on('console', (m) => {
        if ((m.type() === 'error' || m.type() === 'warning') && !expected(m)) {
          pageErrors.push(`${tag} console.${m.type()}: ${m.text()} @ ${m.location().url}`);
        }
      });
      const pathname = () => new URL(page.url()).pathname;

      await step(`${tag} /backgammon/ -> AI menu -> reload`, async () => {
        await page.goto(origin + '/backgammon/');
        await page.locator('.home2').waitFor();
        await page.getByRole('button', { name: /ИИ|AI/ }).click();
        await page.waitForURL(/\/backgammon\/ai$/);
        assert.equal(pathname(), '/backgammon/ai', `${tag}: AI menu pathname`);
        await page.reload();
        await page.locator('.page-head').waitFor();
        assert.equal(pathname(), '/backgammon/ai', `${tag}: pathname after reload of /backgammon/ai`);
      });
      await step(`${tag} /backgammon/play?mode=ai&level=beginner`, async () => {
        await page.goto(origin + '/backgammon/play?mode=ai&level=beginner');
        await page.locator('.board-svg').waitFor();
      });
      await step(`${tag} portal-back link to /`, async () => {
        await page.goto(origin + '/backgammon/');
        await page.locator('.portal-back').click();
        await page.waitForURL((u) => u.pathname === '/');
        assert.equal(pathname(), '/', `${tag}: portal-back landed on ${pathname()}, expected /`);
      });
      if (SHOT_DIR) {
        await step(`${tag} screenshots`, async () => {
          fs.mkdirSync(SHOT_DIR, { recursive: true });
          await page.goto(origin + '/backgammon/');
          await page.locator('.home2').waitFor();
          await page.screenshot({ path: `${SHOT_DIR}/stage-n-${width}-home.png` });
          await page.goto(origin + '/backgammon/play?mode=ai&level=beginner');
          await page.locator('.board-svg').waitFor();
          await page.screenshot({ path: `${SHOT_DIR}/stage-n-${width}-play.png` });
        });
      }
      await context.close();
    }

    // Static/API surface, manifest, CSP, service worker (once; width-independent).
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    let listening = true; // offline reload below produces expected network console errors
    page.on('pageerror', (e) => listening && pageErrors.push(`sw pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (listening && (m.type() === 'error' || m.type() === 'warning') && !expected(m)) {
        pageErrors.push(`sw console.${m.type()}: ${m.text()} @ ${m.location().url}`);
      }
    });

    for (const path of ['/backgammon', '/backgammon/', '/backgammon/manifest.webmanifest', '/backgammon/icon.svg', '/backgammon/api/health']) {
      await step(`GET ${path} -> 200`, async () => {
        assert.equal((await page.request.get(origin + path)).status(), 200, `GET ${path} status`);
      });
    }
    await step('GET /backgammon/ has content-security-policy', async () => {
      const csp = (await page.request.get(origin + '/backgammon/')).headers()['content-security-policy'];
      assert.ok(csp && csp.length > 0, 'GET /backgammon/: no content-security-policy header');
    });
    await step('manifest scope', async () => {
      const url = origin + '/backgammon/manifest.webmanifest';
      const manifest = await (await page.request.get(url)).json();
      assert.equal(new URL(manifest.scope, url).pathname, '/backgammon/', `manifest scope ${manifest.scope}`);
    });
    await step('GET /backgammon/assets/missing.js -> 404', async () => {
      assert.equal((await page.request.get(origin + '/backgammon/assets/missing.js')).status(), 404, 'GET /backgammon/assets/missing.js status');
    });
    await step('service worker scope + offline reload', async () => {
      await page.goto(origin + '/backgammon/');
      const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
      assert.equal(new URL(scope).pathname, '/backgammon/', `service worker scope ${scope}`);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page.reload();
      await page.locator('.home2').waitFor();
      listening = false;
      await context.setOffline(true);
      try {
        await page.reload();
        await page.locator('.home2').waitFor();
      } finally {
        await context.setOffline(false);
      }
    });
    await context.close();
  } catch (e) {
    failures.push(`fatal: ${e && e.stack || e}`);
  } finally {
    await browser.close();
  }

  for (const f of failures) console.error('FAIL ' + f);
  for (const m of pageErrors) console.error('PAGE ' + m);
  const errors = failures.length + pageErrors.length;
  console.log(`widths=${WIDTHS.length} errors=${errors}`);
  process.exit(errors ? 1 : 0);
})();
