import { describe, expect, it } from 'vitest';
import { exportProfileRecords } from '../src/profile-export';
const BASE = process.env.NARDY_URL ?? 'http://127.0.0.1:8791';

it('exports counterpart statistics without exposing authentication secrets or internal fields', () => {
  const secretA = 'a'.repeat(64), secretB = 'b'.repeat(64);
  const exported = exportProfileRecords([
    { id: `pair:${secretA}:short`, value: '{"wins":2,"losses":1}' },
    { id: `daily:2026-11-16:${secretA}`, value: '3' },
    { id: `pair:${secretB}:long`, value: '{"wins":1,"losses":0}' },
    { id: 'event:match-1:2', value: '{"xp":150,"coins":30}' },
    { id: 'active', value: `"${secretB}"` },
    { id: 'future-internal-secret', value: `"${secretA}"` },
  ]);
  expect(JSON.stringify(exported)).not.toContain(secretA);
  expect(JSON.stringify(exported)).not.toContain(secretB);
  expect(exported).toHaveLength(4);
  expect(exported[0]).toMatchObject({ reference: 'opponent-1:short', value: { wins: 2, losses: 1 } });
  expect(exported[1].reference).toBe('2026-11-16:opponent-1');
});

describe('profile privacy API', () => {
  it('requires a credential, isolates exports, and erases server state rather than just the cookie', async () => {
    expect((await fetch(BASE + '/api/profile/export')).status).toBe(401);
    const initialized = await fetch(BASE + '/api/profile', { method: 'POST' });
    expect(initialized.status).toBe(200);
    const cookie = initialized.headers.get('set-cookie')!.split(';')[0];
    const other = await fetch(BASE + '/api/profile', { method: 'POST' });
    const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
    const exported = await fetch(BASE + '/api/profile/export', { headers: { Cookie: cookie } });
    expect(exported.headers.get('Cache-Control')).toBe('no-store');
    expect(exported.headers.get('Content-Disposition')).toContain('attachment');
    const data = await exported.json();
    expect(data).toMatchObject({ version: 1, profile: { xp: 0, coins: 0 } });
    expect(data.lastUsed).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain(cookie.split('=')[1]);
    expect(JSON.stringify(data)).not.toContain(otherCookie.split('=')[1]);
    expect((await fetch(BASE + '/api/profile', { method: 'DELETE', headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status).toBe(403);
    const erased = await fetch(BASE + '/api/profile', { method: 'DELETE', headers: { Cookie: cookie } });
    expect(erased.status).toBe(204);
    expect(erased.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const old = await fetch(BASE + '/api/profile', { headers: { Cookie: cookie } });
    expect(old.status).toBe(401);
    expect((await old.json()).error).toBe('no_profile');
    const untouched = await (await fetch(BASE + '/api/profile', { headers: { Cookie: otherCookie } })).json();
    expect(untouched.profile).toMatchObject({ xp: 0 });
    // Erasure preserves a usable schema, while old progress never reappears.
    const reinit = await fetch(BASE + '/api/profile', { method: 'POST', headers: { Cookie: cookie } });
    expect((await reinit.json()).profile).toMatchObject({ xp: 0, coins: 0, owned: [] });
  });
  it('bounds streaming purchase bodies and rejects non-object JSON', async () => {
    const init = await fetch(BASE + '/api/profile', { method: 'POST' });
    const Cookie = init.headers.get('Set-Cookie')!.split(';')[0];
    for (const body of ['null', '[]', '42']) {
      expect((await fetch(BASE + '/api/profile/purchase', { method: 'POST', headers: { Cookie }, body })).status).toBe(400);
    }
    expect((await fetch(BASE + '/api/profile/purchase', { method: 'POST', headers: { Cookie }, body: 'x'.repeat(1025) })).status).toBe(413);
  });
});
