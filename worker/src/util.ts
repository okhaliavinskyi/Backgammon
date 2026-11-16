import type { Rng } from '@nardy/core';

/** Unbiased die roll from the platform CSPRNG. */
export const cryptoRng: Rng = () => {
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < 252) return 1 + (buf[0] % 6);
  }
};

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomId(len = 6): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += ID_ALPHABET[b % ID_ALPHABET.length];
  return s;
}

export function randomToken(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + ':' + password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const ROOM_ID_RE = /^[A-Z2-9]{6}$/;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
  });
}

/** Bound the body while reading; Content-Length alone is not trustworthy. */
export class BodyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError(400, 'bad_json');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new BodyError(413, 'too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new BodyError(400, 'bad_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BodyError(400, 'bad_json');
  return body as Record<string, unknown>;
}
