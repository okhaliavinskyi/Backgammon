# Optional verified-email profiles

Status: release prepared for `https://onlineboard.fun/backgammon/`; sender configured as `login@mail.onlineboard.fun`. See rollout validation below.

## User flow

Email is optional, exposed only in Profile. A guest chooses Save this profile, enters an email, and receives one message. The browser opens `/auth#<account-key>.<random-token>`; inspect/GET never consumes it. An explicit confirmation binds the existing profile, with its exact XP, balance, inventory, achievements and ratings. A binding must be confirmed in the browser that requested it. No password or marketing subscription is created.

On another device choose Sign in to existing, request a link, and explicitly confirm the switch. Existing guest balances are not merged. The device's old guest cookie is retained so logout can return to that guest profile. Binding the original guest instead removes its guest cookie and disables its old guest credential. Account sessions map back to the original profile ID, preserving match history and ranked identity.

Names are initially carried from the browser that bound the profile; ordinary device settings remain device-local. Finish an active ranked match or cancel its queue before binding/switching.

## Security and data

- 256-bit random links, SHA-256 hashes at rest, 10-minute expiry, one-time atomic consumption. Link secrets live in URL fragments, not request URLs; the frontend removes the fragment after reading it.
- Explicit confirmation protects against mail-scanner prefetch and unexpected account switches. Same-browser binding prevents an unsolicited binding request from attaching somebody else's guest profile.
- Independent random session per device, hashed server-side, HttpOnly/SameSite=Strict cookies, Secure on HTTPS; fixed 90-day expiry. Logout revokes the current session; deleting the profile deletes its email binding and revokes all sessions.
- AccountDO is isolated per normalized email hash; no global account registry. ASCII email addresses are trimmed and lowercased. Profile credentials and session hashes are not exported to opponents.
- Email request response is generic. Unknown login addresses receive the same accepted response but no message. Delivery runs via a lifetime-bound background promise; failures are logged without email/link data. Requests are limited per IP and per address/purpose (one per minute, five per day). New requests replace the previous link.
- Server origin is configured explicitly, preventing request-host injection into links. CSRF origin checks and bounded JSON bodies apply. Confirmation POST requires an explicit boolean action.
- Pending challenges expire; temporary unverified email data is pruned, request-limiter records last up to 24 hours. Active accounts follow the original profile lifetime, with account cleanup after profile disappearance. Session expiry is checked on every authorization.
- Room access resolves the account session to the canonical profile. Revoked sessions and old guest credentials of linked profiles cannot continue sending authenticated room actions; reloading with the current session restores access.
- Profile erasure remains distinct from device cleanup. Device cleanup also revokes that device's account session. Deletion does not erase independent opponent results or already delivered room state.

## Sending prerequisite

The owned domain `onlineboard.fun` is active on Cloudflare Free, with nameservers `rosemary.ns.cloudflare.com` and `uriah.ns.cloudflare.com`. Native Email Sending is enabled for `mail.onlineboard.fun`; the service installed SPF, DKIM, bounce MX and a reject-policy DMARC record. Sender: `login@mail.onlineboard.fun`.

Worker custom domains: `onlineboard.fun` and `www.onlineboard.fun`. The original workers.dev address stays available. `AUTH_ORIGINS` is an explicit comma-separated allowlist of these three HTTPS origins. Links return to `/backgammon/auth` on the catalog origin and `/auth` on the standalone origin. `AUTH_MOUNTED_ORIGINS` explicitly selects the mounted origins; no client-supplied redirect path is accepted. `AUTH_ORIGIN`, when explicitly supplied (for example in local tests), overrides the list.

Guest cookies and local settings are scoped to each host. There is no automatic redirect from the old host: an existing player must bind email on the original workers.dev host, then sign in on the new domain to recover that same progress. Opening the new domain alone creates an independent guest identity; no progress is deleted or implicitly merged.

No configured sender means the UI reports email delivery unavailable; guest games remain available. The native `EMAIL` binding uses local simulation unless `remote=true` is explicitly set. No remote binding is used in tests.

## Local checks

```sh
npm run typecheck
npm run build
npm run dev -w @nardy/worker -- --port 18927 --inspector-port 19241 --persist-to /tmp/nardy-email-local --var EMAIL_FROM:login@local.test --var AUTH_ORIGIN:http://127.0.0.1:18927 > /tmp/nardy-email-local.log 2>&1
NARDY_URL=http://127.0.0.1:18927 NARDY_MAIL_LOG=/tmp/nardy-email-local.log npm run test:integration -w @nardy/worker
```

Auth integration reads only the local email simulator's text files; there is no debug-token API or test bypass in the Worker. It earns real guest progress, buys/equips an avatar, binds, rejects confirmation from another browser, checks non-consuming preview and replay rejection, signs in elsewhere, preserves the other guest on logout, verifies session revocation and profile deletion. Existing guest, ranked and privacy suites run against the same local Worker. CI explicitly uses simulated mail and never sends real messages.

## Validation and limitations

The complete local suite passed 28 core tests and 25 Worker/browser tests. The auth scenario additionally preserved an earned ranked Elo result and restored the other device's guest name on UI logout. It rejects old room tokens for a linked profile, and a revoked account cookie cannot block an otherwise valid guest from playing. Typecheck, build, native email-binding simulation and Worker dry run passed. No real email was sent.

Deleted guest credentials now return 401 instead of a successful null profile response; reinitializing rotates to a fresh random guest ID. The profile client already treats 401 as anonymous. Email change/unlink, recovery without mailbox access, and a device-management dashboard are outside this version. Expiry checks are enforced server-side; a real ten-minute token expiration wait and an artificial cross-object storage failure were not separately injected.

## Rollout checkpoint — 2026-11-16

Cloudflare confirms zone active. Email Sending enabled and authoritative DNS serves
SPF, DKIM, bounce MX and DMARC. Custom domains for nardy attached to apex and www;
the apex has a more specific existing `onlineboard.fun/*` route to the separately
released `onlineboard` catalog, whose `/backgammon/api/health` returns OK.
Imported apex/www A records were preserved under `vercel-parking-root` and
`vercel-parking-www` to resolve Custom Domain conflicts; wildcard/CAA/mail retained.

A concurrent catalog checkout (`codex/onlineboard-portal`) mounts the client at
`/backgammon/`. Do not publish the standalone email client over that catalog.
Owner clarification requested for canonical placement before release; mounted
email links and client paths need integration if that placement is selected.
Email code/config remains local, not merged or deployed. No test email sent;
explicit owner approval requested for delivery to their mailbox.

Latest local validation: typecheck, build, 28 core tests, 26 Worker/browser tests,
native types generation and dry run pass. Ranked smoke passes (968/1032 Elo,
idempotent settlement, name-only guest/friend links, zero page errors). Origin
allowlist checked with two accepted local origins and an unlisted host rejected.


## Mounted email release

Owner selected `/backgammon/`. Integrated the existing portal client base-path
support with profiles, privacy actions, ranked matchmaking and email screens.
Profile/logout navigation, account API requests, report/legal links and friend
invitations remain under that mount. The portal SPA router now includes auth,
profile, ranked and legal routes. Catalog public files are byte-identical to the
previous release; its root HTML SHA-256 is
`f4f476dab2f9a41bdfe07015f6f2b9b2ab142ffbf082a820d94efb24564967d6`.

Deployment publishes the nardy backend first, then the mounted client via the
existing onlineboard Worker. Durable Object names/bindings remain stable; the
only new storage class is AccountDO. No forced redirects or guest reset are used.

Mounted verification: the auth browser scenario passed with exact emailed path
assertions; it preserved earned XP, balance, equipped cosmetics and Elo, recovered
the same profile on another browser, restored that browser's other guest on
logout, and rejected replay/revoked credentials. Mounted ranked smoke and catalog
suite passed, including name-only friend-link entry and zero page errors.
Typechecks, both builds, core 28/28 and both Worker dry runs passed. The complete
standalone Worker suite passed 26/26 before the mount integration. One authorized
plain test message was queued by Cloudflare for the owner's mailbox; inbox
receipt is not yet independently confirmed. Local auth tests simulate all mail.

Local mounted auth reproduction: build both clients; copy the worker config to a
temporary absolute-path config without its custom-domain routes; set EMAIL_FROM
(to a local test sender), AUTH_ORIGINS and AUTH_MOUNTED_ORIGINS to the local portal
origin. Run both Workers with `wrangler dev --config apps/portal/wrangler.jsonc
--config <temporary-worker-config> --infer-origin-from-routes=false`, then set
NARDY_URL to `<portal-origin>/backgammon` and NARDY_MAIL_LOG to that process log
when running `vitest run --root worker test/auth.test.ts`.
