# OnlineBoard

`onlineboard.fun/` serves the game catalog. The backgammon client is built at
`/backgammon/`; API and WebSocket requests under `/backgammon/api/` go to the
existing `nardy` Worker through a service binding.

From the repository root:

```sh
npm ci
node apps/portal/build.mjs
npx tsc --noEmit -p apps/portal
```

For local browser checks, first build the standalone client as well, then run both
Workers in the same local session:

```sh
npm run build
npx wrangler dev --config apps/portal/wrangler.jsonc --config worker/wrangler.toml --port 8790
# In another terminal, with Playwright available:
node e2e/portal.e2e.cjs
NARDY_URL=http://localhost:8790/backgammon node e2e/online.e2e.cjs
```

Set `PORTAL_URL` and `PORTAL_SHOTS` for another URL/screenshot directory.
`portal.e2e.cjs` checks offline support too, so use localhost or HTTPS.

The game uses Vite's `BASE_URL` for navigation, invitations, API URLs, icons and
its service worker. Keep new game links inside that base. The default build still
works at the standalone Worker URL.

To add another game, add its catalog card and a distinct path in the portal
Worker. Vercel apps can use their own upstream; configure their assets and
navigation to respect the mount path. Do not redirect players off this domain.

## Domain

The registrar remains Vercel; authoritative DNS is Cloudflare. The deployment
uses the `onlineboard.fun/*` Worker route on the existing proxied apex DNS record.
This avoids deleting the imported Vercel DNS records. Keep that apex record
proxied. The portal Worker handles every request for the apex domain.

## Verification — 2026-11-16

Typechecks, standalone and mounted builds, Wrangler dry run, catalog/browser
checks at 360/768/1440, scoped manifest/service worker and offline reload passed.
The existing default online suite passed through the mounted path, including
passwords, moves, chat, reload, reconnect and mobile shake with no console errors.
The deployed technical URL passed the catalog/browser suite. The actual domain
passed HTTPS, catalog navigation, private room creation, two WebSocket players
and reload using Chromium DNS pinning to an authoritative Cloudflare address;
TLS validation remained enabled. DNS propagation was still in progress during
verification. Deployment version: 7ff81cfe-ab6a-45c0-b2df-51b97813e096.


Profile, ranked and email confirmation screens are mounted under the same path.
Email links on the canonical portal origin return to `/backgammon/auth`; the
standalone workers.dev origin retains `/auth`. Auth/profile/ranked API calls,
privacy actions and browser navigation must use gamePath, just like invitations.
Catalog public files are unchanged by the email release.

## Vercel games — 2026-11-16

The catalog includes Ctrl V, Guess Who and Sand Sorter. `games.json` holds the
fixed upstream map. The build emits `/ctrl-v/`, `/guess-who/` and `/sand-sorter/`
launch pages with a common return link and fullscreen controls. These pages embed
same-site, separate app origins (`<slug>.onlineboard.fun`). Each app origin proxies
its Vercel deployment without rewriting bundles, Next.js routes, API calls or
service workers. Browser storage and PWA caches remain separate per app.

The existing proxied wildcard DNS record and wildcard certificate cover these
origins; Wrangler owns their three explicit routes. Keep wildcard DNS proxied.
Upstream response headers are retained. Same-origin Origin headers and upstream
redirect locations are mapped between the public app origin and its fixed Vercel
origin. No arbitrary upstream URL can be supplied by visitors. The sandbox keeps
embedded navigation inside the frame while allowing the games' scripts, storage,
fullscreen, audio, downloads and explicit external links.

For local multi-host checks use:

```sh
npx wrangler dev --config apps/portal/wrangler.jsonc --config worker/wrangler.toml --port 8790 --infer-origin-from-routes=false
node e2e/portal-games.e2e.cjs
```

The launch pages use `<slug>.localhost:8790` locally. Disabling route-origin
inference is required for Wrangler to preserve those hostnames. For deployed
checks set `PORTAL_URL=https://onlineboard.fun`.

Verified against local Wrangler and the actual production domain: four catalog
cards, no horizontal overflow at 360/1440, Ctrl V round start, Guess Who character
card, Sand Sorter level 1, fullscreen enter/exit, reload and return to catalog.
Both runs reported no page errors. The existing portal suite also passed in
production at 360/768/1440, including mounted backgammon AI, API, PWA and offline
reload. Device motion on physical iOS/Android hardware was not tested.

Initial release version: `9e181909-8cc5-4a75-9775-cf4b89b124ea`.
Vercel apps retain independent deployments; their future production updates are
picked up by the proxy without rebuilding this catalog.
