# OnlineBoard

`onlineboard.fun/` serves the game catalog. The backgammon client is built at
`/backgammon/`; API and WebSocket requests under `/backgammon/api/` go to the
existing `nardy` Worker through a service binding. That Worker and its Durable
Objects are not redeployed by the portal release.

From the repository root:

```sh
npm ci
node apps/portal/build.mjs
npx tsc --noEmit -p apps/portal
npx wrangler deploy --dry-run --config apps/portal/wrangler.jsonc
npx wrangler deploy --config apps/portal/wrangler.jsonc
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
works at the standalone Worker URL. A portal release builds the game frontend
from the current checkout, so publish only reviewed changes compatible with the
live `nardy` backend.

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
