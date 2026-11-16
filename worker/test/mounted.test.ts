/**
 * Integration test of the client + API mounted under /backgammon/ against a running worker.
 *   NARDY_URL=http://127.0.0.1:8787 npx vitest run worker/test/mounted.test.ts
 * BASE is the origin only, without /backgammon.
 */
import { request as httpRequest } from 'node:http';
import { describe, expect, it } from 'vitest';

const BASE = process.env.NARDY_URL ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');

const get = (path: string, init?: RequestInit) => fetch(`${BASE}${path}`, init);

describe('mounted /backgammon/', () => {
  it('health answers identically on both prefixes', async () => {
    const a = await get('/backgammon/api/health');
    const b = await get('/api/health');
    expect(a.status, '/backgammon/api/health status').toBe(200);
    expect(b.status, '/api/health status').toBe(200);
    expect(a.headers.get('content-type'), '/backgammon/api/health content-type').toContain('application/json');
    expect(a.headers.get('content-type'), 'content-type differs between prefixes').toBe(b.headers.get('content-type'));
    expect(await a.json(), '/backgammon/api/health body').toEqual({ ok: true });
    expect(await b.json(), '/api/health body').toEqual({ ok: true });
  });

  it('creates a room and opens its WebSocket under the mount', async () => {
    const r = await get('/backgammon/api/rooms', { method: 'POST', body: JSON.stringify({}) });
    expect(r.status, 'POST /backgammon/api/rooms status').toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(id, 'room id').toMatch(/^[A-Za-z0-9]{6}$/);

    const ws = new WebSocket(`${WS}/backgammon/api/rooms/${id}/ws`);
    try {
      // welcome comes after hello (see integration.test.ts)
      const welcome = new Promise<{ t: string }>((res, rej) => {
        const t = setTimeout(() => rej(new Error('no welcome within 5s')), 5000);
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data as string) as { t: string };
          if (m.t === 'welcome') (clearTimeout(t), res(m));
        };
        ws.onerror = () => (clearTimeout(t), rej(new Error('ws error on mounted path')));
      });
      await new Promise((res, rej) => ((ws.onopen = res), void (ws.onclose = () => rej(new Error('ws closed before open')))));
      ws.send(JSON.stringify({ t: 'hello', name: 'Mounted' }));
      expect((await welcome).t, `first welcome on /backgammon/api/rooms/${id}/ws`).toBe('welcome');
    } finally {
      ws.close();
    }
  });

  it('redirects /backgammon to /backgammon/ with 308, keeping the query', async () => {
    const a = await get('/backgammon', { redirect: 'manual' });
    expect(a.status, '/backgammon status').toBe(308);
    expect(a.headers.get('location'), '/backgammon location').toMatch(/\/backgammon\/$/);
    const b = await get('/backgammon?x=1', { redirect: 'manual' });
    expect(b.status, '/backgammon?x=1 status').toBe(308);
    expect(b.headers.get('location'), '/backgammon?x=1 location').toMatch(/\/backgammon\/\?x=1$/);
  });

  it('returns the branded 404 for unknown paths and missing assets', async () => {
    for (const path of ['/backgammon/assets/missing.js', '/backgammon/nope', '/backgammon/online/x']) {
      const r = await get(path);
      expect(r.status, `${path} status`).toBe(404);
      expect(await r.text(), `${path} body`).toContain('Страница не найдена');
    }
  });

  it('serves the SPA shell with mounted asset URLs on every client route', async () => {
    for (const path of ['/backgammon/', '/backgammon/ai', '/backgammon/online', '/backgammon/r/ABC123']) {
      const r = await get(path);
      expect(r.status, `${path} status`).toBe(200);
      expect(r.headers.get('content-type'), `${path} content-type`).toContain('text/html');
      const body = await r.text();
      expect(body, `${path} lacks /backgammon/assets/`).toContain('/backgammon/assets/');
      expect(body, `${path} contains unmounted "/assets/`).not.toContain('"/assets/');
    }
  });

  it('serves a real mounted asset', async () => {
    const html = await (await get('/backgammon/')).text();
    const src = html.match(/\/backgammon\/assets\/[^"'\s>]+\.js/)?.[0];
    expect(src, 'no /backgammon/assets/*.js reference in /backgammon/').toBeTruthy();
    const r = await get(src!);
    expect(r.status, `${src} status`).toBe(200);
    expect(r.headers.get('content-type'), `${src} content-type`).toMatch(/javascript/);
    await r.arrayBuffer();
  });

  it('rejects non-GET/HEAD on a mounted page with 405', async () => {
    const r = await get('/backgammon/online', { method: 'POST' });
    expect(r.status, 'POST /backgammon/online status').toBe(405);
    expect(r.headers.get('allow'), 'POST /backgammon/online Allow').toBe('GET, HEAD');
  });

  it('sends security headers on the mounted shell', async () => {
    const r = await get('/backgammon/');
    expect(r.headers.get('content-security-policy'), '/backgammon/ content-security-policy').toBeTruthy();
    expect(r.headers.get('x-frame-options'), '/backgammon/ x-frame-options').toBe('DENY');
  });

  it('leaves the standalone client untouched', async () => {
    for (const path of ['/ai', '/']) {
      const r = await get(path);
      expect(r.status, `${path} status`).toBe(200);
      expect(r.headers.get('content-type'), `${path} content-type`).toContain('text/html');
      const body = await r.text();
      expect(body, `${path} lacks "/assets/`).toContain('"/assets/');
      expect(body, `${path} leaks /backgammon/assets/`).not.toContain('/backgammon/assets/');
    }
    expect((await get('/api/health')).status, '/api/health status').toBe(200);
  });

  it('rejects a foreign Origin on the mounted API with 403', async () => {
    // node:http, not fetch: undici's fetch may strip or override Origin (a forbidden request header in the
    // Fetch spec), which would make this test pass or fail for the wrong reason. http.request sends it verbatim.
    const u = new URL(`${BASE}/backgammon/api/rooms`);
    const status = await new Promise<number>((res, rej) => {
      const req = httpRequest(
        { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' } },
        (resp) => (resp.resume(), res(resp.statusCode ?? 0)),
      );
      req.on('error', rej);
      req.end('{}');
    });
    expect(status, 'POST /backgammon/api/rooms with Origin https://evil.example').toBe(403);
  });
});
