# Privacy and legal release checklist

Status: implementation in progress; legal pages are drafts until operator details are confirmed.

Confirmed service model: free hobby project, no monetary bets or balance top-ups. No current advertising; advertising may be considered later. The owner prefers not to publish their personal name. No identity/address has been supplied or authorised for publication. Hobby status is not treated as an exemption from data-protection transparency. Prize policy, operator country and age policy still need confirmation.

## Required before release

- Add the dedicated project email to `legalContact` in `apps/web/src/lib/legal.ts` once supplied. Resolve controller identification without publishing personal details unless separately authorised; confirm countries and age terms. Remove the preliminary notice only after all release conditions are resolved.
- Review Spanish LSSI applicability and required public identification with the actual operator structure. Do not substitute invented contact details.
- Verify Cloudflare account DPA, applicable transfer mechanism, subprocessor information, account access/MFA, Workers Logs retention, log payloads and Durable Object backup/PITR retention. Document actual durations in the policy. EU-only residency is not configured or promised.
- Reserve rate-limit namespaces 736401 and 736402 for this application; verify they do not collide with another Worker in the account. Edge counters are approximate, not a global strict quota.
- Final legal review should consider operator location, targeted countries, age policy, public nicknames and the two-player chat. Do not assume every DSA online-platform obligation applies.
- Inventory direct/transitive dependency licenses and provenance of artwork and names; preserve required notices. Browser runtime notices for React, React DOM, scheduler and Zustand are included in third-party-notices.txt; the current source inventory is recorded in ASSET-NOTICES.md; artwork/name provenance still requires confirmation.
- Approve deployment explicitly; pushing main deploys production.

## Rights requests and complaints

Monitor the published mailbox. Acknowledge privacy requests, record receipt and response deadlines (normally one month under GDPR, extensions only where permitted). Ask for room code, approximate time and a proportionate verification method; never solicit room passwords or reconnect tokens by email. Do not release an opponent's data in response to an unverified request. Explain if a room has already expired. Consider access, rectification, erasure, restriction, portability and objections as applicable; preserve only legally justified records. Deleting browser data does not delete server state or a recipient's copy.

For abuse reports, record the room/time and minimal relevant evidence. Do not promise permanent chat archives: only the last 50 messages exist and rooms expire. Respond to rights-holder notices and illegal-content reports; restrict service access only on a supported basis. Reassess moderation infrastructure as usage grows.

## Incident response

Restrict access, contain the issue and preserve minimal necessary evidence. Identify affected data, persons, duration and likelihood/severity of harm. Record the assessment and remediation. If a personal data breach triggers GDPR Article 33, notify the competent authority without undue delay and where feasible within 72 hours of awareness; document delay and the decision if notification is not required. Assess Article 34 notice to affected users separately. Never publish passwords or reconnect tokens in incident notes.

## Retention behavior

- Browser settings and AI save: until the user clears them.
- Room tokens: pruned at next app startup 24 hours after last successful welcome; legacy undated tokens are dated on first launch after upgrading.
- New room password: sessionStorage until successful hello or tab session end.
- Rooms and chat: inactivity alarm after 30 minutes; retained while players remain connected. No fixed maximum room lifetime.
- Lobby: entries removed on game start/destruction; stale entries pruned on listing after one hour.
- Infrastructure logs and recoverable backups: must be verified in the account, not inferred from application deletion.

## Sources

- GDPR: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Spanish LSSI: https://www.boe.es/eli/es/l/2002/07/11/34/
- Spanish LOPDGDD: https://www.boe.es/eli/es/lo/2018/12/05/3/
- Cloudflare data location: https://developers.cloudflare.com/durable-objects/reference/data-location/
- Cloudflare rate limits: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## Current implementation: 16 November 2026

The owner explicitly requested completion without publishing their personal name/address and will supply a separate project mailbox later. `apps/web/src/lib/legal.ts` contains only an empty public project email; no personal identity/address was inserted. The legal pages intentionally remain marked preliminary. Hobby status and a future email alone do not complete GDPR controller identification. Country-specific applicability, identification, age terms, infrastructure transfers and contract verification remain release conditions; do not silently set `legalReadyForPublication` to true after adding only an email.

Current legal-basis draft: legitimate interests under GDPR 6(1)(f) for requested online gameplay, guest progression and abuse prevention; 6(1)(c) only for an actual applicable legal duty. No blanket consent is inferred from playing. See the separate legitimate-interest assessment. No advertising, payment, deposit, real-money stakes or cash-out is implemented. Game coins only acquire in-game cosmetic items; they are not external-value prizes. Future ads require a new provider/data-flow review and consent where required before nonessential tracking starts.

Guest profiles use a 365-day inactivity period measured from the last initialization (online entry or opening the profile); a Durable Object alarm deletes profile records after expiry. It is independent of the browser cookie's lifetime. Profile actions:

- `GET /api/profile/export`: authenticated cookie required, attachment with no-store headers. Exports profile, last initialization and supported reward/statistic records. Opponent credential keys become export-local labels; active room locks, arbitrary future internal fields and access credentials are excluded.
- `DELETE /api/profile`: erases the live profile table and expires the cookie. Late room rewards cannot recreate an erased profile because `record()` requires an existing profile. Other browsers' profiles remain untouched.
- `DELETE /api/profile/device`: expires only the current device's cookie. The UI then clears the app's local/session storage, service worker and app caches. This is not server erasure.
- Profile deletion does not erase current room state, messages already received by the opponent or aggregate counters in an opponent's profile. These limitations are shown before actions. Room data follows its own inactivity deletion. Infrastructure recoverability must be handled separately.
- A failed network operation reports failure and leaves local access intact, allowing retry. The UI never claims successful server erasure based only on clearing local storage.

### Operational retention and restoration

Workers Logs documentation currently describes 3 days on Free and 7 days on Paid; verify the actual account plan, destinations and settings. SQLite Durable Objects documentation describes up to 30 days of point-in-time recovery. These provider defaults are evidence to check, not proof that every account copy is gone. Record actual settings before final publication and recheck after plan/provider changes.

Never restore erased user data to ordinary service as part of a backup restore. Keep a minimal, access-controlled deletion record where necessary to reapply erasures after recovery; do not place raw profile cookies, passwords or chat into incident/deletion logs. Erasure from the live database is distinct from the provider's bounded recovery retention.

### Validation commands

Run one local Wrangler with a separate `--persist-to` directory. Use `NARDY_URL` consistently. Run Worker suites from `worker/` so sibling `.claude/worktrees` are not discovered. Restart the test Worker or wait for the rate window before repeating request-heavy suites; do not weaken production limits to make tests pass.

- `npm run typecheck`, `npm test`, `npm run build`.
- From `worker/`: `NARDY_URL=http://127.0.0.1:8791 npx vitest run test/privacy.test.ts test/integration.test.ts`.
- `NARDY_URL=http://127.0.0.1:8791 node e2e/privacy.e2e.cjs`.
- `NARDY_URL=http://127.0.0.1:8791 REJOIN_ONLY=1 node e2e/online.e2e.cjs`.

Additional primary sources: https://developers.cloudflare.com/workers/observability/logs/workers-logs/ and https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ .

## Ranked matchmaking (V1-B)

Guest ratings, placement counts and per-match Elo changes use the existing profile retention and export/deletion mechanisms. Matchmaking stores the guest credential internally for reservation, a display name, an Elo snapshot and queue timestamps; credentials are never returned to other players. One queue object is used per game variant. Waiting entries expire after 30 seconds without heartbeat; provisional profile tickets expire after 45 seconds. A committed assignment remains reserved until the room starts and finishes, or the one-minute start deadline cancels it. Active rated rooms use the normal room lifecycle, retaining undelivered rating events for retry rather than deleting a pending result. Ratings and rating history are included in profile exports; internal reservation keys are excluded. Deleting a profile does not erase the opponent's independent result or already delivered room state.
