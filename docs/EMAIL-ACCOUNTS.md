# Optional verified-email profiles

Status: implemented; production domain and sender configured for `onlineboard.fun`. See rollout validation below.

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

Worker custom domains: `onlineboard.fun` and `www.onlineboard.fun`. The original workers.dev address stays available. `AUTH_ORIGINS` is an explicit comma-separated allowlist of these three HTTPS origins. Links return to the origin where they were requested. `AUTH_ORIGIN`, when explicitly supplied (for example in local tests), overrides the list.

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
