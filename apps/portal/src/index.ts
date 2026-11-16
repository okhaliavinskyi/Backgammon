import games from '../games.json';

// Future games can use independent origins and release cycles.
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const game = games.find(game => url.hostname === game.slug + '.onlineboard.fun' || url.hostname === game.slug + '.localhost');
    if (game) {
      // Dedicated app origins keep root paths, PWA caches and storage isolated.
      const upstream = new URL(path + url.search, game.origin);
      const headers = new Headers(request.headers);
      if (headers.get('Origin') === url.origin) headers.set('Origin', upstream.origin);
      const response = await fetch(new Request(upstream, { method: request.method, headers, body: request.body, redirect: 'manual' }));
      const location = response.headers.get('Location');
      if (location) {
        const redirect = new URL(location, upstream);
        if (redirect.origin === upstream.origin) {
          const result = new Response(response.body, response);
          result.headers.set('Location', url.origin + redirect.pathname + redirect.search + redirect.hash);
          return result;
        }
      }
      return response;
    }
    const mountedGame = games.find(game => path === '/' + game.slug || path === '/' + game.slug + '/');
    if (mountedGame) {
      if (!path.endsWith('/')) {
        url.pathname += '/';
        return Response.redirect(url.toString(), 308);
      }
      url.pathname += 'index.html';
    }
    if (path === '/backgammon') {
      url.pathname += '/';
      return Response.redirect(url.toString(), 308);
    }
    if (path.startsWith('/backgammon/api/')) {
      // Preserve host and Origin for same-origin checks; return WebSockets untouched.
      url.pathname = path.slice('/backgammon'.length);
      return env.NARDY.fetch(new Request(url, request));
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    if (path === '/') url.pathname = '/index.html';
    if (/^\/backgammon\/(?:|online|create|ai|local|settings|play|profile|ranked|auth|privacy|terms|legal|r\/[A-Za-z0-9]{6})$/.test(path)) {
      url.pathname = '/backgammon/index.html';
    }
    const response = await env.ASSETS.fetch(new Request(url, request));
    if (response.status === 404) {
      return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Страница не найдена · OnlineBoard</title><h1>Страница не найдена</h1><a href="/">Все игры OnlineBoard</a></html>', {
        status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
