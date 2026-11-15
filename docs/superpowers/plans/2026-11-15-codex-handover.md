# Handover: implement the mobile UX + rejoin plan end to end

You are implementing an approved plan in the repository at the current working directory (online long/short nardy: React 19 + Vite client in `apps/web`, Cloudflare Worker + Durable Objects in `worker/`, rules engine in `packages/core`). You own the implementation from the first task to the last. Work autonomously; stop only on the conditions in "Stop and report".

## 0. Echo probe — your first output, before any edit

Read the two documents below and print exactly one line with these four values, separated by ` | `:
1. the undo window in ms,
2. the cross-axis length of the vertical board,
3. `hint.edge` for the `malachite` theme,
4. the port Task 1 runs `wrangler dev` on.

Then continue without waiting.

## 1. Read first (source of truth)

- Spec: `docs/superpowers/specs/2026-11-15-mobile-ux-rejoin-design.md` (sections A–F).
- Plan: `docs/superpowers/plans/2026-11-15-mobile-ux-rejoin.md`. Follow its batch map, task order, file ownership, code, gates and break-checks **as written**. Its "Review log" explains why each piece looks the way it does; do not undo those fixes.
- Where the plan and the spec disagree, the plan wins (it is the reviewed refinement). Where plan code fails when executed, fix the code minimally, keep the intent, and record the deviation (see §5).

## 2. Branch

```bash
git switch -c feat/mobile-ux-rejoin
```

Commit per task with the exact message in the plan, staging **explicit paths only** — never `git add -A` / `git add .`. Never push, never deploy, never touch `main` or `.github/`.

## 3. Order of work

Execute the plan's batch map sequentially (you are a single agent, so batches simply run in order):

1. Task 0 — i18n strings.
2. Task 1 — server rejoin (`worker/src/room.ts`, `worker/test/integration.test.ts`).
3. Task 2 — turn flow (auto-confirm with undo window, auto-roll with ×2 countdown, `paused`/`sent`/`doubled`, tap-to-move, settings migration, e2e changes).
4. End of batch 1 — e2e + worker integration on :8787.
5. Task 3 — two-tone hints, capped stacks, `contrast.ts`, e2e selectors.
6. Task 4 — rejoin screen + e2e rejoin scenario.
7. Task 5 — vertical board (rotation `matrix(0 1 -1 0 660 0)`, `geom(660)`), compact phone chrome, measurement and input gates.
8. Final verification section of the plan.

Do the TDD steps in order: write the failing check, run it and **see it fail for the stated reason**, implement, see it pass, run the break-check (break the feature → the check goes red naming the problem → restore).

## 4. Environment notes (verified 2026-11-15)

- `npm install` at the repo root if `node_modules` is missing. Node 22.
- Typecheck: `npm run typecheck -w @nardy/web`, `npm run typecheck -w @nardy/worker`. Build: `npm run build`. Core tests: `npm test`.
- `wrangler dev` refuses to start without `apps/web/dist` → run `npm run build` first. Start it in the background, kill it when done. Ports: Task 1 uses **8788**; e2e and batch-end integration use **8787**.
- Worker integration: `cd worker && NARDY_URL=http://127.0.0.1:<port> npx vitest run test/integration.test.ts`.
- e2e: `node e2e/online.e2e.cjs` against :8787. Playwright is not a project dependency; it exists at `~/.npm/_npx/9833c18b2d85bc59/node_modules` — run with `NODE_PATH=<that path>` and launch Chromium with `{ channel: 'chrome' }` (bundled headless shell is missing).
- `node --experimental-strip-types` cannot import `apps/web/src/components/geometry.ts` (it imports `@nardy/core` with extensionless re-exports). The plan already routes around this: contrast script imports `themes.ts`; the stacks check bundles with `npx esbuild`.
- **Read exit codes from the command itself**, e.g. `node x.mjs; echo EXIT=$?` — never through a pipe (`| tail` returns tail's status).
- If your sandbox blocks localhost networking or launching Chrome, do not substitute reading for running: write `not verified: <reason>` for that gate and continue with the rest.

## 5. Rules

- Never work from memory: every line number, field, function and threshold is checked in this tree before you rely on it.
- A gate that passes when the feature is deleted is not a gate — every gate in the plan has a break-check; run it.
- Checks name what they found ("checked 15 pairs", "ratio 0.668", "checkers outside board: none"); report the printed numbers, not "passed".
- Do not edit the spec. Do not edit the plan except appending a `## Implementation log` section at its end: one line per task with commit hash, gates run (with printed numbers), break-checks run, and every deviation from the plan code with the reason.
- Do not add dependencies. Do not refactor beyond what a task requires.
- Design values (Task 3 colours, Task 5 corner mapping, chrome layout) are starting values from the plan; implement them as written — the owner may revise them after reviewing screenshots.

## 6. Live verification

UI tasks (2–5) are not done until rendered: build, run `wrangler dev` on :8787, drive the app with Playwright at 360×780 (mobile emulation), 768×1024 and 1440×900, in all three themes (`wood`, `minimal`, `malachite` — set via the `nardy.settings` localStorage seed with `version: 1`). Save screenshots to `docs/design/impl-screens/<task>-<width>-<theme>.png` (create the folder; commit them with the task). Check the browser console for new errors in each run and report them.

## 7. Stop and report (do not push through)

- A gate cannot be made green without changing the spec's behaviour.
- A plan step relies on something that does not exist and the fix is not obvious.
- Tests that passed before your change now fail and the cause is outside your task's files.
- Anything destructive outside the branch would be needed.

## 8. Final report (your last message)

1. Echo-probe line (repeated).
2. Per task: commit hash, files, gates with printed numbers, break-checks (red output → restored green).
3. Final verification: typecheck/test/integration/e2e exit codes; per width × theme the measured values (board ratio, checker diameter, movable rings vs expected, stack heights); console errors (or "none" with the count of pages checked).
4. Deviations from the plan, each with reason.
5. `not verified: <reason>` list.
6. `git log --oneline` of the branch and `git status` (must be clean).
