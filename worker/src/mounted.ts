// Serves the client mounted under /backgammon/ (built with --base=/backgammon/ into dist/backgammon).
// Returns a Response when the request is fully handled here, or the Request to continue with:
// /backgammon/api/* is rewritten to /api/* (host and Origin preserved) and handled by the normal API code.
const MOUNT = '/backgammon';
// SPA routes of the mounted client, moved verbatim from apps/portal/src/index.ts.
const SPA = /^\/backgammon\/(?:|online|create|ai|local|settings|play|profile|ranked|auth|privacy|terms|legal|r\/[A-Za-z0-9]{6})$/;
// Same bytes the portal serves for an unknown path under /backgammon/.
const NOT_FOUND = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Страница не найдена · OnlineBoard</title><h1>Страница не найдена</h1><a href="/">Все игры OnlineBoard</a></html>';

export async function mount(request: Request, assets: Fetcher): Promise<Response | Request> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === MOUNT) {
    url.pathname += '/';
    return Response.redirect(url.toString(), 308);
  }
  if (path.startsWith(MOUNT + '/api/')) {
    url.pathname = path.slice(MOUNT.length);
    return new Request(url, request);
  }
  if (!path.startsWith(MOUNT + '/')) return request;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (SPA.test(path)) url.pathname = MOUNT + '/';
  const response = await assets.fetch(new Request(url, request));
  // 404 mechanism: nardy runs assets with not_found_handling = "single-page-application", so a missing
  // asset comes back as 200 text/html (the root index.html). The only html under /backgammon/ is /backgammon/
  // itself (SPA routes were rewritten to it above), so any other html response means "no such asset".
  if (url.pathname !== MOUNT + '/' && response.headers.get('Content-Type')?.includes('text/html')) {
    return new Response(NOT_FOUND, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return response;
}
