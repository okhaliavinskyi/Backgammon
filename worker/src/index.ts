import { PROFILE_COOKIE, profileToken, sanitizeName, sanitizeSettings } from '@nardy/core';
import { LobbyDO } from './lobby';
import { RoomDO } from './room';
import { ROOM_ID_RE, json, randomId, readJsonObject, BodyError } from './util';

import { ProfileDO } from './profile';
export { LobbyDO, RoomDO, ProfileDO };

export interface Env {
  PROFILE: DurableObjectNamespace<ProfileDO>;
  ROOM: DurableObjectNamespace<RoomDO>;
  LOBBY: DurableObjectNamespace<LobbyDO>;
  ASSETS: Fetcher;
  CREATE_LIMITER: RateLimit;
  CONNECT_LIMITER: RateLimit;
}

const room = (env: Env, id: string) => env.ROOM.get(env.ROOM.idFromName(id));

async function createRoom(request: Request, env: Env): Promise<Response> {
  let body: { settings?: unknown; password?: unknown; name?: unknown };
  try {
    body = await readJsonObject(request, 4096);
  } catch (error) {
    return json({ error: error instanceof BodyError ? error.message : 'bad_json' }, error instanceof BodyError ? error.status : 400);
  }
  const settings = sanitizeSettings(body.settings as never);
  const password = typeof body.password === 'string' && body.password.length > 0 ? body.password.slice(0, 64) : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomId();
    if (await room(env, id).init(id, settings, password, sanitizeName(body.name))) return json({ id }, 201);
  }
  return json({ error: 'try_again' }, 503);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
    const key = request.headers.get('CF-Connecting-IP') ?? 'local';

    if (path === '/api/profile/export' || (path === '/api/profile' && request.method === 'DELETE')) {
      if (!(await env.CONNECT_LIMITER.limit({ key })).success) return json({ error: 'rate_limited' }, 429);
      const token = profileToken(request.headers.get('Cookie'));
      if (!token) return json({ error: 'no_profile' }, 401);
      const stub = env.PROFILE.get(env.PROFILE.idFromName(token));
      if (path.endsWith('/export')) {
        if (request.method !== 'GET') return json({ error: 'method' }, 405);
        const response = json(await stub.exportData());
        response.headers.set('Content-Disposition', 'attachment; filename="nardy-profile.json"');
        return response;
      }
      await stub.erase();
      return new Response(null, { status: 204, headers: {
        'Set-Cookie': `${PROFILE_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}`,
        'Cache-Control': 'no-store',
      } });
    }

    if (path === '/api/profile/device' && request.method === 'DELETE') return new Response(null, { status: 204, headers: {
      'Set-Cookie': `${PROFILE_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}`,
      'Cache-Control': 'no-store',
    } });

    if (path === '/api/profile' || path === '/api/profile/purchase' || path === '/api/profile/equip') {
      if (!(await env.CONNECT_LIMITER.limit({ key })).success) return json({ error: 'rate_limited' }, 429);
      let token = profileToken(request.headers.get('Cookie'));
      if (path === '/api/profile' && request.method === 'POST') {
        if (!(await env.CREATE_LIMITER.limit({ key: 'profile:' + key })).success) return json({ error: 'rate_limited' }, 429);
        if (!token) token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
        const profile = await env.PROFILE.get(env.PROFILE.idFromName(token)).init(token);
        return new Response(JSON.stringify({ profile }), { headers: {
          'Content-Type': 'application/json', 'Cache-Control': 'no-store',
          'Set-Cookie': `${PROFILE_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${url.protocol === 'https:' ? '; Secure' : ''}`,
        } });
      }
      if (!token) return json({ error: 'no_profile' }, 401);
      const stub = env.PROFILE.get(env.PROFILE.idFromName(token));
      if (path === '/api/profile' && request.method === 'GET') return new Response(JSON.stringify({ profile: await stub.getProfile() }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      let body: Record<string, unknown>;
      try { body = await readJsonObject(request, 1024); }
      catch (error) { return json({ error: error instanceof BodyError ? error.message : 'bad_json' }, error instanceof BodyError ? error.status : 400); }
      if (typeof body.id !== 'string' && body.id !== null) return json({ error: 'bad_json' }, 400);
      if (path.endsWith('/equip') && !['avatar', 'frame', 'dice', 'theme'].includes(String(body.kind))) return json({ error: 'bad_json' }, 400);
      const result = path.endsWith('/purchase') ? await stub.purchase(body.id as string) : await stub.equip(body.kind as import('@nardy/core').CosmeticKind, body.id);
      return new Response(JSON.stringify(result), { status: result.error ? 400 : 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

    if (path === '/api/health') return json({ ok: true });

    if (path === '/api/rooms') {
      if (request.method === 'POST') {
        if (!(await env.CREATE_LIMITER.limit({ key })).success) return json({ error: 'rate_limited' }, 429);
        return createRoom(request, env);
      }
      if (request.method === 'GET') return json({ rooms: await env.LOBBY.get(env.LOBBY.idFromName('global')).list() });
      return json({ error: 'method' }, 405);
    }

    const m = path.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(\/ws)?$/);
    if (m) {
      const id = m[1].toUpperCase();
      if (!ROOM_ID_RE.test(id)) return json({ error: 'bad_id' }, 400);
      if (!(await env.CONNECT_LIMITER.limit({ key })).success) return json({ error: 'rate_limited' }, 429);
      if (m[2]) return room(env, id).fetch(request);
      if (request.method !== 'GET') return json({ error: 'method' }, 405);
      return json(await room(env, id).info());
    }
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
