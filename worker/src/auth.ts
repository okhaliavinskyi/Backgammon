import type { Env } from './index';
import { PROFILE_COOKIE, profileToken, sanitizeName } from '@nardy/core';
import {
  accountStub,
  cookieHeader,
  normalizeEmail,
  resolveProfile,
  sessionCookie,
  sha256,
  SESSION_COOKIE,
  SESSION_MS,
} from './auth-util';
import { json, readJsonObject } from './util';
export async function handleAuth(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    cookie = request.headers.get('Cookie');
  const session = sessionCookie(cookie),
    configured =
      !!env.EMAIL_FROM &&
      (env.AUTH_ORIGIN ?? env.AUTH_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .includes(url.origin);
  if (
    !(
      await env.CONNECT_LIMITER.limit({
        key: 'auth:' + (request.headers.get('CF-Connecting-IP') ?? 'local'),
      })
    ).success
  )
    return json({ error: 'rate_limited' }, 429);
  if (path === '/api/auth/status' && request.method === 'GET') {
    const account = session
      ? await accountStub(env, session.split('.')[0]).status(
          await sha256(session.split('.')[1]),
        )
      : null;
    return json({ configured, account });
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    if (session)
      await accountStub(env, session.split('.')[0]).logout(
        await sha256(session.split('.')[1]),
      );
    const response = json({ ok: true });
    response.headers.append(
      'Set-Cookie',
      cookieHeader(SESSION_COOKIE, '', 0, url.origin),
    );
    return response;
  }
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, 1024);
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (path === '/api/auth/request') {
    if (!configured) return json({ error: 'email_not_configured' }, 503);
    const email = normalizeEmail(body.email),
      kind = body.kind;
    if (!email || (kind !== 'bind' && kind !== 'login'))
      return json({ error: 'invalid_email' }, 400);
    let profile = await resolveProfile(cookie, env);
    const key = await sha256(email);
    if (kind === 'bind' && !profile) {
      const raw = profileToken(cookie);
      if (
        raw &&
        (await env.PROFILE.get(env.PROFILE.idFromName(raw)).linkedAccount())
          ?.id === key
      )
        profile = raw;
    }
    if (kind === 'bind' && !profile) return json({ error: 'no_profile' }, 401);
    if (
      !(
        await env.CREATE_LIMITER.limit({
          key: 'email:' + (request.headers.get('CF-Connecting-IP') ?? 'local'),
        })
      ).success
    )
      return json({ error: 'rate_limited' }, 429);
    await accountStub(env, key).request(
      key,
      email,
      kind,
      profile,
      sanitizeName(body.name),
      url.origin,
      body.lang === 'ru',
    );
    return json({ accepted: true });
  }
  if (path === '/api/auth/inspect' || path === '/api/auth/confirm') {
    const token = typeof body.token === 'string' ? body.token : '';
    if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token))
      return json({ error: 'expired_link' }, 400);
    const [key, secret] = token.split('.'),
      stub = accountStub(env, key),
      hash = await sha256(secret);
    const info = await stub.inspect(hash);
    if (!info) return json({ error: 'expired_link' }, 400);
    let current = await resolveProfile(cookie, env);
    // Recover an interrupted same-browser binding without reopening guest access.
    if (!current && info.kind === 'bind') current = profileToken(cookie);
    if (path.endsWith('/inspect')) {
      const p = current
        ? await env.PROFILE.get(env.PROFILE.idFromName(current)).getProfile()
        : null;
      const hasGuestProgress =
        !!p &&
        current !== info.target &&
        (p.xp > 0 ||
          p.coins > 0 ||
          p.owned.length > 0 ||
          p.stats.long.matches > 0 ||
          p.stats.short.matches > 0);
      const { target: _target, ...publicInfo } = info;
      return json({ ...publicInfo, hasGuestProgress });
    }
    if (body.confirm !== true)
      return json({ error: 'confirmation_required' }, 400);
    const result = await stub.confirm(hash, current);
    if (result.error) return json({ error: result.error }, 409);
    const response = json({ ok: true, name: result.name });
    response.headers.append(
      'Set-Cookie',
      cookieHeader(
        SESSION_COOKIE,
        result.session!,
        Math.floor(SESSION_MS / 1000),
        url.origin,
      ),
    );
    if (info.kind === 'bind')
      response.headers.append(
        'Set-Cookie',
        cookieHeader(PROFILE_COOKIE, '', 0, url.origin),
      );
    return response;
  }
  return json({ error: 'not_found' }, 404);
}
