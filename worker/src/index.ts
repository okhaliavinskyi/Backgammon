import { AccountDO } from './account';
import { handleAuth } from './auth';
import { resolveProfile, sessionCookie, accountStub, SESSION_COOKIE, cookieHeader, sha256 } from './auth-util';
import { PROFILE_COOKIE, sanitizeName, sanitizeSettings } from '@nardy/core';
import { LobbyDO } from './lobby';
import { RoomDO } from './room';
import { ROOM_ID_RE, json, randomId, readJsonObject, BodyError } from './util';

import { MatchmakingDO } from './matchmaking';
import { ProfileDO } from './profile';
export { LobbyDO, RoomDO, ProfileDO, MatchmakingDO, AccountDO };

export interface Env {
  ACCOUNT: DurableObjectNamespace<AccountDO>;
  EMAIL: SendEmail;
  EMAIL_FROM?: string;
  AUTH_ORIGIN?: string;
  MATCHMAKING: DurableObjectNamespace<MatchmakingDO>;
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

    if(path.startsWith('/api/auth/'))return handleAuth(request,env);

    const rankedRoute = path.match(/^\/api\/ranked\/(long|short)$/);
    if (rankedRoute) {
      if (!['GET','POST','DELETE'].includes(request.method)) return json({ error: 'method' }, 405);
      if (!(await env.CONNECT_LIMITER.limit({ key: 'ranked:' + key })).success) return json({ error: 'rate_limited' }, 429);
      const token = await resolveProfile(request.headers.get('Cookie'),env);
      if (!token) return json({ error: 'no_profile' }, 401);
      const profile = env.PROFILE.get(env.PROFILE.idFromName(token));
      if (!await profile.getProfile()) return json({ error: 'no_profile' }, 401);
      let name = '';
      if (request.method === 'POST') {
        try { name = sanitizeName((await readJsonObject(request, 256)).name); }
        catch (e) { return json({ error: 'bad_json' }, e instanceof BodyError ? e.status : 400); }
      }
      const variant = rankedRoute[1] as 'long' | 'short';
      try {
        return json(await env.MATCHMAKING.get(env.MATCHMAKING.idFromName(variant)).request(token, variant, request.method === 'POST' ? 'join' : request.method === 'DELETE' ? 'cancel' : 'status', name));
      } catch { return json({ error: 'matchmaking_unavailable' }, 503); }
    }

    if (path === '/api/profile/export' || (path === '/api/profile' && request.method === 'DELETE')) {
      if (!(await env.CONNECT_LIMITER.limit({ key })).success) return json({ error: 'rate_limited' }, 429);
      const token = await resolveProfile(request.headers.get('Cookie'),env);
      if (!token) return json({ error: 'no_profile' }, 401);
      const stub = env.PROFILE.get(env.PROFILE.idFromName(token));
      if (path.endsWith('/export')) {
        if (request.method !== 'GET') return json({ error: 'method' }, 405);
        const response = json(await stub.exportData());
        response.headers.set('Content-Disposition', 'attachment; filename="nardy-profile.json"');
        return response;
      }
      const linked=await stub.linkedAccount();
      await stub.erase();
      if(linked)await accountStub(env,linked.id).erase(token);
      const headers=new Headers({'Cache-Control':'no-store'});
      headers.append('Set-Cookie',cookieHeader(SESSION_COOKIE,'',0,url.origin));
      headers.append('Set-Cookie',cookieHeader(PROFILE_COOKIE,'',0,url.origin));
      return new Response(null,{status:204,headers});

    }

    if (path === '/api/profile/device' && request.method === 'DELETE') {
      const session=sessionCookie(request.headers.get('Cookie'));
      if(session)await accountStub(env,session.split('.')[0]).logout(await sha256(session.split('.')[1]));
      const headers=new Headers({'Cache-Control':'no-store'});
      headers.append('Set-Cookie',cookieHeader(PROFILE_COOKIE,'',0,url.origin));
      headers.append('Set-Cookie',cookieHeader(SESSION_COOKIE,'',0,url.origin));
      return new Response(null,{status:204,headers});
    }

    if (path === '/api/profile' || path === '/api/profile/purchase' || path === '/api/profile/equip') {
      if (!(await env.CONNECT_LIMITER.limit({ key })).success) return json({ error: 'rate_limited' }, 429);
      let token = await resolveProfile(request.headers.get('Cookie'),env);
      if (path === '/api/profile' && request.method === 'POST') {
        const existing = token ? await env.PROFILE.get(env.PROFILE.idFromName(token)).getProfile() : null;
        if (!existing && !(await env.CREATE_LIMITER.limit({ key: 'profile:' + key })).success) return json({ error: 'rate_limited' }, 429);
        if (!existing) token = null;
        if (!token) token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
        const profile = await env.PROFILE.get(env.PROFILE.idFromName(token)).init(token);
        return new Response(JSON.stringify({ profile }), { headers: {
          'Content-Type': 'application/json', 'Cache-Control': 'no-store',
          ...(!sessionCookie(request.headers.get('Cookie')) || !existing ? { 'Set-Cookie': `${PROFILE_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${url.protocol === 'https:' ? '; Secure' : ''}` } : {}),
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
