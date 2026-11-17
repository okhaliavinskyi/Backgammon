# Production reconciliation — 2026-11-17

The GitHub baseline was Backgammon `3ca3426` and GamePortal `3683a2e`.
Cloudflare was subsequently changed by manual publications:

- nardy: `8c7aab9f-fea3-4c4c-b33e-afeb58b197ab`, 2026-11-16 23:41 UTC;
- onlineboard: `2fb8608f-a590-4986-9d5f-c8ed948bd2d3`, 23:37 UTC.

Those publications reintroduced the legacy embedded portal and removed nardy's
mounted routing. The apex game lacked CSP although the standalone/www game had
it. A normal deploy from Git main would also lose the published dice changes.

This integration preserves the published balanced-v2 policy and AI dice history,
adds them to Git, and retains the mounted client/API implementation from stage N.
AI diagnostics use the game's base path. The browser smoke accepts the expected
profile 401 wording on HTTP/2 while still checking its exact endpoint.

Release order: Backgammon CI/deploy, then GamePortal manual workflow on main.
Only nardy builds game assets; onlineboard forwards /backgammon/* through NARDY.
The old apps/portal source remains historical until the separately planned cleanup.

Unrelated uncommitted gamification/privacy work was not included. Balanced dice
files were copied from the release worktree without clearing its dirty state.
