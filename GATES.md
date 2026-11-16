# Gates — screens redesign

## G1 menu screens
OWNS: Menus.tsx, Room.tsx, menus.css, icons.tsx, main.tsx, App.tsx
CHECK: NODE_PATH=$HOME/.npm/_npx/9833c18b2d85bc59/node_modules node e2e/screens.e2e.cjs
EXPECT: exit=0, offenders=0; presence, no UI emoji, no overflow, tap targets, RU/EN at 360/768/1440
EVIDENCE: RED on merged base 8a0d7ec: exit=1, offenders=223 (e.g. 360 RU home: emoji in button 🌐 Играть онлайн; missing .menu-row). Base default online e2e exit=0, ERRORS=[]; typecheck/build exit=0; core 25/25. Logs: /tmp/nardy-base.log, /tmp/nardy-g1-red.log, /tmp/nardy-g2-red.log. GREEN after Task 5: exit=0, offenders=0 (/tmp/nardy-g1-green.log), RU/EN × 360/768/1440. Intermediate G1: Task 2 offenders=145 (home clean), Task 3=91 (setup/create clean), Task 4=24 (lobby/settings clean).

## G2 game HUD
OWNS: GameHud.tsx, game-hud.css, Game.tsx
CHECK: NODE_PATH=$HOME/.npm/_npx/9833c18b2d85bc59/node_modules node e2e/hud.e2e.cjs; default + all modes of online.e2e.cjs
EXPECT: exit=0 each; hud offenders=0
EVIDENCE: RED on merged base 8a0d7ec: exit=1, offenders=3; 360 RU/EN and 1440 RU each found 0 .strip, expected 2. Base board→HUD gap measured 103.28125px (threshold 16px). GREEN: exit=0, offenders=0 (final G2); all 11 e2e invocations exit=0. See final acceptance below.


## Final acceptance — 2026-11-16

Environment: single local Wrangler 4.162.0 at http://127.0.0.1:8787, installed Chrome,
Playwright from `$HOME/.npm/_npx/9833c18b2d85bc59/node_modules`.
Export NODE_PATH to that directory and NARDY_URL to that URL for browser commands.
Use `IMPL_SCREEN_DIR=/tmp/nardy-acceptance-shots` for legacy e2e modes to preserve historical PNGs.

| CHECK | EXPECT | EVIDENCE |
|---|---|---|
| npm run typecheck | exit=0 | pass, all workspaces |
| npm test | exit=0 | 25/25 core tests |
| npm run build | exit=0 | Vite 45 modules, no dependency changes |
| npx vitest run --root worker test/integration.test.ts | exit=0 | 8/8 integration tests against local server |
| node e2e/screens.e2e.cjs | exit=0, offenders=0 | pass, RU/EN × 360/768/1440 |
| node e2e/hud.e2e.cjs | exit=0, offenders=0 | pass, positive strips/status/score/pips, gaps, targets |
| node e2e/redesign.e2e.cjs | exit=0, console errors=0 | pass, 3 themes × 3 widths; resume/long names/filter/copy/password/error/motion UI/online chat |
| node --experimental-strip-types apps/web/scripts/contrast.ts | exit=0 | rim minima 6.54/4.80/5.49:1, point numbers >=4.78:1 |

Final e2e mode log `/tmp/nardy-final-modes.log`:

```text
[DEFAULT] exit=0 log=/tmp/nardy-mode-DEFAULT.log
[LAYOUT_ONLY=1 HINT_GATE=1 TASK=verification] exit=0 log=/tmp/nardy-mode-LAYOUT_ONLY.log
[STATES_ONLY=1] exit=0 log=/tmp/nardy-mode-STATES_ONLY.log
[GHOST_ONLY=1] exit=0 log=/tmp/nardy-mode-GHOST_ONLY.log
[PREVIEW_ONLY=1 PREVIEW_PREFIX=redesign] exit=0 log=/tmp/nardy-mode-PREVIEW_ONLY.log
[INPUT_ONLY=1] exit=0 log=/tmp/nardy-mode-INPUT_ONLY.log
[REVIEW_ONLY=1] exit=0 log=/tmp/nardy-mode-REVIEW_ONLY.log
[REVIEW_ONLY=1 BOARD_ONLY=1] exit=0 log=/tmp/nardy-mode-BOARD_ONLY.log
[REJOIN_ONLY=1] exit=0 log=/tmp/nardy-mode-REJOIN_ONLY.log
[RECOVERY_ONLY=1] exit=0 log=/tmp/nardy-mode-RECOVERY_ONLY.log
[T2_ONLY=1] exit=0 log=/tmp/nardy-mode-T2_ONLY.log
```

STATES_ONLY: 63 pages, console errors=0; includes phone double-actions bounds and
unchanged board dimensions. PREVIEW_ONLY: all themes top=140.390625, width=344,
height=431.953125, bottomGap=12, 30 rims, Undo restores numeric pips, hints persist,
Escape closes settings with URL and mounted SVG preserved; 0 errors on 6 online pages.
Layout/input includes legacy 768 portrait (2 pbar, 0 strip), phone tap/drag and landscape.

Primary text contrast on accent, measured from live theme CSS: wood 8.81:1,
minimal 11.43:1, malachite 11.01:1. Standalone settings speed is 2×2; match-length stays
one row. At 360×640 last setup segment bottom=527.64 < bottom bar top=555.44;
last lobby card bottom=527.95 < code bar top=565.83. Desktop online chat rect lies
between opponent and own strips; a real message arrived in both contexts.

Screenshots: `docs/design/impl-screens/redesign-*.png`; viewport captures plus lobby
bottom, 20-character W names, online hints/Undo/settings and magnified checker details.
Old tracked screenshots were not overwritten. Exact private-canvas parity and owner
visual approval are not claimed; reference unavailable, durable spec used.

## Implementation review status

Independent read-only CLI review attempted, but failed before analysis: configured
model unsupported for that CLI account (also MCP init HTTP 403). NOT a green review.
Self-audit and detailed implementation evidence:
`docs/superpowers/plans/2026-11-16-screens-redesign-implementation.md`.
No push, main merge, deployment, or production verification performed.

# Gates — stage N (nardy serves /backgammon/*)

Base = `4bf9eba` (worker copy without custom-domain routes, root client only), branch = HEAD. Local `wrangler dev` 4.162.0,
ports 8841 (base) / 8842 (branch), vars `EMAIL_FROM`, `AUTH_ORIGINS`, `AUTH_MOUNTED_ORIGINS` = own origin. Return codes read from the script, not a pipe.
Run: `export NODE_PATH=$HOME/.npm/_npx/9833c18b2d85bc59/node_modules`.

## N1 build
OWNS: package.json (build), apps/web/package.json (build:mounted)
CHECK: `npm run build` rc; `test -f apps/web/dist/backgammon/index.html`; `grep -c '/backgammon/assets/' apps/web/dist/backgammon/index.html`; `grep -c '"/assets/' …/backgammon/index.html`; `grep -c '/backgammon' apps/web/dist/index.html`
EXPECT: rc=0; file exists; 2 (>=2); 0; 0
EVIDENCE: GREEN: rc=0, links=2, root links=0, base-build `/backgammon` refs=0. RED: on base `dist/backgammon` does not exist (base copy built without `build:mounted`; `ls` → absent).

## N2 statuses (worker/test/mounted.test.ts)
OWNS: worker/src/mounted.ts, worker/wrangler.toml (run_worker_first)
CHECK: `NARDY_URL=http://127.0.0.1:<port> npx vitest run --root worker test/mounted.test.ts`
EXPECT: 10/10, rc=0
EVIDENCE: GREEN branch 10/10 rc=0. RED base: rc=1, 8 failed of 10 (health html, 308, 404, SPA assets, asset, 405, 403, WS). RED with the 404 rule disabled (`if (false && …)`): rc=1, 1 failed "returns the branded 404 for unknown paths and missing assets"; rule restored, rc=0.

## N3 browser e2e 360/768/1440 (e2e/mounted.e2e.cjs)
OWNS: e2e/mounted.e2e.cjs
CHECK: `NARDY_URL=http://127.0.0.1:<port> node e2e/mounted.e2e.cjs; echo rc=$?`
EXPECT: rc=0, `widths=3 errors=0` (pageerror and console error/warning listed by name; filtered by name: vibrate, favicon, AudioContext autoplay, guest 401 on /api/profile)
EVIDENCE: GREEN branch rc=0 errors=0. RED base: killed by 200 s alarm (rc=142): `/backgammon/ai` is not served by the mounted client, `.home2` waits time out. Screenshots: `docs/design/impl-screens/stage-n-{360,768,1440}-{home,play}.png`.

## N4 CSP / service worker / manifest / offline (inside N3)
EXPECT: SW scope pathname `/backgammon/`, manifest scope `/backgammon/`, offline reload keeps `.home2`, `/backgammon/` carries content-security-policy, console clean under the CSP
EVIDENCE: GREEN inside N3. RED: `apps/web/dist/_headers` with `img-src 'none'` → rc=1, named "Loading the image '…/backgammon/icon-192.png' violates … img-src 'none'" at sw/w1440. (`manifest-src 'none'` stayed green — Chrome does not fetch the manifest at load; `connect-src 'none'` hung to the alarm — neither used as evidence.) `_headers` restored (diff clean).

## N5 auth links through the mount
CHECK: `NARDY_URL=http://127.0.0.1:<port>/backgammon NARDY_MAIL_LOG=<wrangler log> npx vitest run --root worker test/auth.test.ts`
EXPECT: 2/2, rc=0; link in mail `<origin>/backgammon/auth#…` (asserted by the test via BASE)
EVIDENCE: GREEN branch 2/2 rc=0. RED base: rc=1, `expected 405 to be 200`.

## N6 additivity of www paths
CHECK: status, content-type, sha256 of body, CSP presence for `/`, `/ai`, `/api/health`, `/assets/missing.js`, `/manifest.webmanifest`, `/sw.js` on base and branch; `diff` the two snapshots (not raw ETags)
EXPECT: diff rc=0
EVIDENCE: GREEN diff rc=0 (identical). Intentional difference outside this list: `/backgammon/nope` base 200 → branch 404 (named in spec §4.5).

## N7 old portal build (regression)
CHECK: `npm run build:portal` rc; `apps/portal/dist/backgammon/index.html` has >=2 `/backgammon/assets/` and 0 `"/assets/`
EVIDENCE: GREEN rc=0 links=2 root=0. RED: `--base=/backgammon/` removed from `apps/portal/build.mjs` → links=0, check rc=1; file restored with `git checkout --`, GREEN again.

## N8 live browser
EVIDENCE: N3 at 360 (mobile emulation), 768, 1440: home and AI board render under CSP, console clean; screenshots viewed (360 home, 1440 play).
