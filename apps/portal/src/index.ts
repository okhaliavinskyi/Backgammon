// Future games can use independent origins and release cycles.
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
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
