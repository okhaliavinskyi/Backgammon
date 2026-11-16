import { profileToken } from '@nardy/core';
import type { Env } from './index';
export const SESSION_COOKIE = 'nardy_session';
export const TOKEN_MS = 10 * 60_000;
export const SESSION_MS = 90 * 24 * 60 * 60_000;
export const randomSecret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export const sha256 = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  const parts = email.split('@');
  if (parts.length !== 2 || email.length > 254) return null;
  const [local, domain] = parts;
  if (
    !local ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
  )
    return null;
  const labels = domain.split('.');
  return labels.length >= 2 &&
    labels.at(-1)!.length >= 2 &&
    labels.every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
    ? email
    : null;
}
export function sessionCookie(cookie: string | null): string | null {
  const value = cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(SESSION_COOKIE + '='))
    ?.slice(SESSION_COOKIE.length + 1);
  return value && /^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value) ? value : null;
}
export function accountStub(env: Env, key: string) {
  return env.ACCOUNT.get(env.ACCOUNT.idFromName(key));
}
export async function sessionProfile(
  session: string,
  env: Env,
): Promise<string | null> {
  const [key, secret] = session.split('.');
  if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(secret))
    return null;
  return accountStub(env, key).resolve(await sha256(secret));
}
export async function resolveIdentity(
  cookie: string | null,
  env: Env,
): Promise<{ profile: string | null; session: string | null }> {
  const session = sessionCookie(cookie);
  if (session) {
    const profile = await sessionProfile(session, env);
    if (profile) return { profile, session };
  }
  const guest = profileToken(cookie);
  const profile = guest && await env.PROFILE.get(env.PROFILE.idFromName(guest)).guestAllowed() ? guest : null;
  return { profile, session: null };
}
export async function resolveProfile(cookie: string | null, env: Env): Promise<string | null> {
  return (await resolveIdentity(cookie, env)).profile;
}
export function cookieHeader(
  name: string,
  value: string,
  maxAge: number,
  origin: string,
): string {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
}
