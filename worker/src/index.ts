import { sanitizeName, sanitizeSettings } from '@nardy/core';
import { LobbyDO } from './lobby';
import { RoomDO } from './room';
import { ROOM_ID_RE, json, randomId } from './util';

export { LobbyDO, RoomDO };

export interface Env {
  ROOM: DurableObjectNamespace<RoomDO>;
  LOBBY: DurableObjectNamespace<LobbyDO>;
  ASSETS: Fetcher;
}

const room = (env: Env, id: string) => env.ROOM.get(env.ROOM.idFromName(id));

async function createRoom(request: Request, env: Env): Promise<Response> {
  let body: { settings?: unknown; password?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
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

    if (path === '/api/health') return json({ ok: true });

    if (path === '/api/rooms') {
      if (request.method === 'POST') return createRoom(request, env);
      if (request.method === 'GET') return json({ rooms: await env.LOBBY.get(env.LOBBY.idFromName('global')).list() });
      return json({ error: 'method' }, 405);
    }

    const m = path.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(\/ws)?$/);
    if (m) {
      const id = m[1].toUpperCase();
      if (!ROOM_ID_RE.test(id)) return json({ error: 'bad_id' }, 400);
      if (m[2]) return room(env, id).fetch(request);
      return json(await room(env, id).info());
    }
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
