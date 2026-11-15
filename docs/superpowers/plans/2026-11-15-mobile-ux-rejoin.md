# Mobile turn UX, move hints, stacks, vertical board, room rejoin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement spec `docs/superpowers/specs/2026-11-15-mobile-ux-rejoin-design.md` (A–F).

**Architecture:** Server change is confined to `RoomDO` (`info()` + `onHello`). Client turn flow stays in `Game.tsx`; hints and stacks live in `Board.tsx` + `themes.ts` + `geometry.ts`; the vertical board is a clockwise rotation of a geometry with a shorter cross axis (660 instead of 800).

**Tech Stack:** React 19 + Vite, zustand 5.1.0 (`persist` `version`/`migrate` — checked in `node_modules/zustand/middleware/persist.d.ts:46-54`; migrate runs only when stored version ≠ option version, confirmed by review simulation), Cloudflare Workers + Durable Objects (wrangler 4), vitest 5, Playwright (npx cache, `channel: 'chrome'`).

## Global Constraints

- Defaults: `autoConfirm=true`, `autoRoll=true`; toggles stay.
- Undo window **1200 ms**; doubling countdown **2000 ms**; auto-roll delay **450 ms**.
- Hint marks: ≥ **3:1** contrast (max of fill/edge) against `field`, `pointA`, `pointB`, white and black checker bases; edge band ≥ **2 CSS px** at 360 px width.
- Stacks: height ≤ **290** board units (5 × 58) for any n ≤ 15.
- Vertical board: portrait **and** width < **768 px**; cross axis **660**; at 360×780 board height ≥ **0.65** of `innerHeight`, checker diameter ≥ **30 CSS px** (computed: 0.668 / 30.2 px; 390×844: 0.671 / 32.9; 412×915: 0.656 / 34.8).
- Rejoin: only into a seat with `disconnectedAt !== null`; password still required; old token stops matching.
- Verification: widths 360, 768, 1440; themes wood, minimal, malachite.

## Readers of changed shared fields

| Field | Readers |
|---|---|
| `Settings.autoRoll/autoConfirm` defaults + persist version | `screens/Game.tsx:180,221`, `screens/Menus.tsx:312-313`, `e2e/online.e2e.cjs:7` (seeds `version: 0` → would migrate to autoRoll=true and break the shake scenario `:95-112`) |
| `RoomInfo` | `screens/Room.tsx` `Info`, `worker/test/integration.test.ts:54` (`toMatchObject`), `:161` (`toEqual({ exists: false })` — unchanged for missing rooms), `:177` |
| `onHello` `room_full` | `remote.ts` `onFatal`, `Room.tsx`, test `:79-80` (both online → still `room_full`) |
| hint classes `.pulse` on board marks | `e2e/online.e2e.cjs:22,26,28` (move playing selectors) — replaced by `data-hint` |
| `geometry.ts` constants (`VB_H`, `TOP`, `BOTTOM`, `MID_Y`, `POINT_LEN`, `stackSpacing`) | `Board.tsx`, `geometry.ts` itself (`checkerPos`, `offPos`, `barPos`) — `grep -n "from './geometry'" apps/web/src` |

## Known ceilings (accepted)

- ponytail: creator who lost their token while the room is still **waiting** joins as seat 1 against their own offline seat 0. Upgrade: offer "take seat as <name>" vs "join as opponent".
- ponytail: passwordless room — anyone with the link can take an offline seat (owner accepted).
- Phantom sockets (dropped without close) keep a seat "online" → rejoin gets `room_full` until the platform closes the socket. Heartbeat timeout out of scope.

- `info().offlineName` reveals an offline player's name to anyone with the room id, before the password (same id is already a capability to see the lobby card). Accepted.
- A player holding a dead token (seat reclaimed) gets the password prompt rather than "room full"; if their old seat is offline they reclaim it back. Accepted.
- Diameter gate margin at 360×780 is 0.23 px (30.23 vs 30): a padding change in `.game` can trip it — that is the intent.
- `apps/web/scripts/contrast.ts` is outside `tsconfig include: ["src"]` — runtime-checked only.

## Pipeline position

Design step (CLAUDE.md step 5) runs **after** plan review and **before** sign-off: screens in `docs/design/` for C, D, F (three themes × 360/768/1440, states: own turn with hints, selected with targets, undo window, ×2 countdown, stack of 10, rejoin screen). Task 3 colour values and Task 5 corner mapping are confirmed or replaced by the approved screens; the gates below stay.

---

## Batch map

Web tasks run `tsc -p apps/web` / `vite build`, which read every web file → one web task per batch. E2E needs `wrangler dev` serving `worker/src` → e2e runs only at batch end by the orchestrator, never inside a batch where `worker/src` is being written.

| Batch | Task | Owner files (write) | Reads | Model |
|---|---|---|---|---|
| 0 | T0 i18n strings | `apps/web/src/lib/i18n.ts` | — | orchestrator (Opus) |
| 1 | T1 server rejoin | `worker/src/room.ts`, `worker/test/integration.test.ts` | `@nardy/core`; own `wrangler dev` on **:8788** | Sonnet (needs localhost network; codex unavailable: `gpt-6.1-sol` rejected for ChatGPT login, verified 2026-11-15) |
| 1 | T2 turn flow | `apps/web/src/screens/Game.tsx`, `apps/web/src/lib/settings.ts`, `apps/web/src/styles.css`, `e2e/online.e2e.cjs` | web package (no e2e run in-batch) | orchestrator (Opus) |
| end 1 | e2e run + worker integration on :8787 | read-only | | orchestrator |
| 2 | T3 hints + stacks | `apps/web/src/components/Board.tsx`, `apps/web/src/components/themes.ts`, `apps/web/src/components/geometry.ts`, `apps/web/scripts/contrast.ts` (new), `e2e/online.e2e.cjs` | web package | Sonnet |
| 3 | T4 rejoin screen | `apps/web/src/screens/Room.tsx`, `e2e/online.e2e.cjs` | T1 `info()` fields | Sonnet |
| 4 | T5 vertical board | `apps/web/src/components/geometry.ts`, `apps/web/src/components/Board.tsx`, `apps/web/src/screens/Game.tsx`, `apps/web/src/styles.css`, `e2e/online.e2e.cjs` | web package | orchestrator (Opus) |
| end | Review: flagship reviewers until zero P0-P2, then full diff → codex GPT-6-Astra-Medium if the CLI accepts a model for this login (otherwise named as not run) | read-only | | |

`e2e/online.e2e.cjs` is written in batches 1, 2, 3 — one writer per batch.
Before any codex dispatch: `< /dev/null`, echo-probe of 3 values from this plan, `node_modules` in the worktree.

---

### Task 0: i18n strings

**Files:** `apps/web/src/lib/i18n.ts` (ru next to `roomFull` `:47`, en next to `:178`).
**Produces:** `T.rejoinAs` (`'Вернуться в игру как'` / `'Rejoin as'`), `T.rejoin` (`'Вернуться'` / `'Rejoin'`), `T.more` (`'Ещё'` / `'More'`).

- [ ] Add the three keys to both objects.
- [ ] `npm run typecheck -w @nardy/web; echo EXIT=$?` → 0.
- [ ] Commit `apps/web/src/lib/i18n.ts`: `feat(web): strings for rejoin and more menu`.

### Task 1: Server — rejoin into an offline seat

**Files:** `worker/src/room.ts` (`RoomInfo` `:59-66`, `info()` `:110-121`, `onHello` `:174-212`), `worker/test/integration.test.ts`.
**Produces:** `RoomInfo.seatsOffline?: number`, `RoomInfo.offlineName?: string | null`. Seat to reclaim = first `c in [0,1]` with `seats[c]?.disconnectedAt !== null`.

- [ ] **Step 1: failing tests** — append inside `describe('hardening')`:

```ts
const BASE2 = process.env.NARDY_URL ?? 'http://127.0.0.1:8787';
async function fullRoom(password?: string) {
  const r = await fetch(`${BASE2}/api/rooms`, { method: 'POST', body: JSON.stringify({ settings: { isPublic: false, moveTimer: 0, bank: 0 }, password }) });
  const { id } = (await r.json()) as { id: string };
  const a = new Client(); await a.open(id); a.send({ t: 'hello', name: 'Alice', password });
  const wa = (await a.wait((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
  const b = new Client(); await b.open(id); b.send({ t: 'hello', name: 'Bob', password });
  const wb = (await b.wait((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
  await a.wait((m) => m.t === 'state' && !!m.match);
  return { id, a, b, wa, wb };
}
const info = async (id: string) => (await fetch(`${BASE2}/api/rooms/${id}`)).json();
const settle = () => new Promise((r) => setTimeout(r, 300));
const reply = (c: Client) => c.wait((m) => m.t === 'welcome' || m.t === 'error');

it('both online: no token → room_full, info says 0 offline', async () => {
  const { id } = await fullRoom('pw');
  expect(await info(id)).toMatchObject({ seatsTaken: 2, seatsOffline: 0, offlineName: null });
  const c = new Client(); await c.open(id); c.send({ t: 'hello', name: 'Eve', password: 'pw' });
  expect(await reply(c)).toMatchObject({ t: 'error', code: 'room_full' });
});

it('offline seat: no token + right password → takes the seat, old token dead', async () => {
  const { id, b, wb } = await fullRoom('pw');
  b.ws.close(); await settle();
  const c = new Client(); await c.open(id); c.send({ t: 'hello', name: 'Bob2', password: 'pw' });
  const w = await reply(c);
  expect(w).toMatchObject({ t: 'welcome', you: 1 });
  expect((w as Extract<ServerMsg, { t: 'welcome' }>).token).not.toBe(wb.token);
  c.ws.close(); await settle();
  // A live old token would be welcomed regardless of password; bad_password proves it no longer matches.
  const old = new Client(); await old.open(id); old.send({ t: 'hello', name: 'Bob', token: wb.token, password: 'nope' });
  expect(await reply(old)).toMatchObject({ t: 'error', code: 'bad_password' });
});

it('offline seat: info names it; wrong password → bad_password, seat untouched', async () => {
  const { id, b } = await fullRoom('pw');
  b.ws.close(); await settle();
  expect(await info(id)).toMatchObject({ seatsOffline: 1, offlineName: 'Bob' });
  const c = new Client(); await c.open(id); c.send({ t: 'hello', name: 'Eve', password: 'x' });
  expect(await reply(c)).toMatchObject({ t: 'error', code: 'bad_password' });
  expect(await info(id)).toMatchObject({ seatsOffline: 1, offlineName: 'Bob' });
});
```

- [ ] **Step 2: run, expect FAIL** — `test -d apps/web/dist || npm run build` (wrangler refuses to start without the assets dir), then `cd worker && npx wrangler dev --port 8788` (background), then `cd worker && NARDY_URL=http://127.0.0.1:8788 npx vitest run test/integration.test.ts; echo EXIT=$?`. Expected (review run): `Tests 3 failed | 5 passed`; test 1 on `seatsOffline` undefined, test 2 on `room_full` instead of `welcome`, test 3 on `seatsOffline`.
- [ ] **Step 3: implement**

```ts
// RoomInfo
  seatsOffline?: number;
  offlineName?: string | null;

// RoomDO
  private offlineSeat(): Color | null {
    const s = this.s!;
    for (const c of [0, 1] as Color[]) if (s.seats[c] && s.seats[c]!.disconnectedAt !== null) return c;
    return null;
  }

// info(), inside the exists:true object
      seatsOffline: s.seats.filter((x) => x && x.disconnectedAt !== null).length,
      offlineName: (() => { const c = this.offlineSeat(); return c === null ? null : s.seats[c]!.name; })(),

// onHello: replace the `const free = ...` line
      const free = s.seats[0] === null ? 0 : s.seats[1] === null ? 1 : this.offlineSeat();
```

The password check above `free` already covers every token-less hello. `s.seats[seat] = { name, token: randomToken(), disconnectedAt: null }` replaces the token. Match is not restarted (`!s.match` is false).
- [ ] **Step 4:** re-run → `Tests 8 passed`, EXIT=0.
- [ ] **Step 5: break-check** — replace `this.offlineSeat()` with `null`; test 2 must fail naming `room_full` (not a timeout); restore.
- [ ] **Step 6:** `npm run typecheck -w @nardy/worker; echo EXIT=$?` → 0; kill wrangler :8788. Commit the two files: `feat(worker): rejoin a full room into an offline seat`.

### Task 2: Turn flow

**Files:** `apps/web/src/lib/settings.ts`, `apps/web/src/screens/Game.tsx`, `apps/web/src/styles.css`, `e2e/online.e2e.cjs`.
**Produces:** `.countdown` CSS (bar emptying over `--ms`); `Game.tsx` consts `UNDO_MS`, `DOUBLE_MS`; `button.undo-send`.

- [ ] **Step 1: settings migration** (`settings.ts`):

```ts
      autoRoll: true,
      autoConfirm: true,
...
    {
      name: 'nardy.settings',
      version: 1,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<Settings>;
        return (version < 1 ? { ...s, autoRoll: true, autoConfirm: true } : s) as Settings;
      },
    },
```

- [ ] **Step 2: undo window** — replace `Game.tsx:179-184`:

Place these two lines **above** `canInteract` (`Game.tsx:145`), next to the other turn state (otherwise TS2448, verified in review round 2). The reset fires on every server message that replaces `m` and on error/connection changes, so a dropped or rejected send never leaves the player stuck (same-seq resync after reconnect, `GameError` without state):

```ts
const [sent, setSent] = useState(false);
const [doubled, setDoubled] = useState(false);
// After a rejected move (`error` without `state`) we never auto-resend: `paused` stops the window, ✓ Done shows instead.
const [paused, setPaused] = useState(false);
useEffect(() => { setSent(false); setDoubled(false); if (g.error) setPaused(true); }, [m, g.error, g.conn]);
useEffect(() => setPaused(false), [m.seq, m.gameNo]);
```

`submit` clears the previous error before sending (`useGame.setState({ error: null })`), so a repeated identical error code still changes `g.error` (null → code) and fires the reset — otherwise `Object.is` equal strings leave `sent=true` forever (round 3).

Then, replacing `:173-184`:

```ts
const UNDO_MS = 1200;
const [sendAt, setSendAt] = useState<number | null>(null);
const submit = useCallback(() => {
  if (!pending || sent) return;
  setSent(true);
  setSendAt(null);
  useGame.setState({ error: null });
  submittedSeq.current = pending.seq;
  ctrl.move(pending.chains.flat());
}, [pending, ctrl, sent]);
useEffect(() => {
  if (sent || paused || !(turnDone && pending && pending.chains.length > 0 && st.autoConfirm && !busy)) { setSendAt(null); return; }
  setSendAt(Date.now() + UNDO_MS);
  const id = setTimeout(submit, UNDO_MS);
  return () => clearTimeout(id);
}, [turnDone, pending, st.autoConfirm, submit, busy, sent, paused]);
```

(The old `submit` at `:173-177` is replaced by this one; `useGame` is already imported from `../controllers/store`.) `canInteract` gains `&& !sent`. Controls row when `st.autoConfirm`: `✓ Done` renders only while `paused`; the plain `↶ Undo` renders while `pending.chains.length > 0 && sendAt === null` (mid-turn undo stays available); while `sendAt !== null` it is replaced by

```tsx
<button className="btn primary undo-send" onClick={undo}>
  ↶ {T.undo}
  <i className="countdown" style={{ ['--ms' as string]: `${UNDO_MS}ms` }} key={sendAt} />
</button>
```

When `!st.autoConfirm`, the old buttons render as today.
- [ ] **Step 3: auto-roll + doubling countdown** — replace `Game.tsx:220-225`:

```ts
const DOUBLE_MS = 2000; // `doubled` is declared in Step 2
useEffect(() => {
  if (!rollActor || !st.autoRoll || doubled) return;
  const id = setTimeout(doRoll, mayDouble ? DOUBLE_MS : 450);
  return () => clearTimeout(id);
}, [rollActor, st.autoRoll, mayDouble, doRoll, m.seq, doubled]);
```

Roll prompt block: when `st.autoRoll`, render only (if `mayDouble && !doubled`)

```tsx
<button className="btn gold" onClick={() => { setDoubled(true); ctrl.double(); }}>
  ×2 {T.double}
  <i className="countdown" style={{ ['--ms' as string]: `${DOUBLE_MS}ms` }} />
</button>
```

`🎲 Roll`, the shake hint and enable-shake render only when `!st.autoRoll`. Shake listener guard gets `!st.autoRoll`. In `onLocClick`, `if (rollActor && !mayDouble) return doRoll();` becomes `if (rollActor && !mayDouble && !st.autoRoll) return doRoll();`.
- [ ] **Step 4: tap-to-move with one target** — in `onLocClick`, **after** `if (selected && dests.has(loc)) return playChain(...)` (so tapping a selected checker's target that holds another movable checker still plays the selected one) and before the `movable.has(loc)` select line:

```ts
if (movable.has(loc) && pending && mover !== null) {
  const ds = destinationsFrom(pending.ts, locToPos(loc, mover), memoRef.current);
  if (ds.length === 1) return playChain(ds[0].steps);
}
```

(No `selected !== loc` condition: an auto-selected checker with one target also moves on tap.)
- [ ] **Step 5: CSS** after `.controls .status`:

```css
.countdown { position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: currentColor; opacity: .55; transform-origin: left; animation: countdown var(--ms) linear forwards; }
@keyframes countdown { to { transform: scaleX(0); } }
.undo-send, .center-actions .btn.gold { position: relative; overflow: hidden; }
```

In the `prefers-reduced-motion` block: `.countdown { animation: none; opacity: 0; }`.
- [ ] **Step 6: e2e** (`e2e/online.e2e.cjs`): seeds use `version: 1` (keep `autoRoll: false` for the existing players and the shake phone). Make it fail loudly: at the end `if (errors.length) process.exit(1)`; after the online game assert pips changed for both players (throw with the numbers otherwise); assert shake dice === 2. `Game.tsx` adds `data-pips={c === viewer ? 'me' : 'opp'}` on the `.pmeta` element (T5 keeps this attribute in the vertical chrome). Add context `M2` playing **vs AI** (`/play?mode=ai&level=beginner`), viewport 1100×900, seed `autoRoll: true, autoConfirm: true`: (a) within 1500 ms of its turn `.dice-tray:not(.single) .die-wrap` count is 2 (the opening dice are `.single` and must not count); (b) record `[data-pips="me"]` text right before the **last** tap of the turn; after it, `button.undo-send` is visible; click it → `[data-pips="me"]` equals the recorded value (undo removes the last fragment only); (c) finish again and wait 1600 ms → the AI's turn starts (status text changes away from "Ваш ход"). (d) Online pair, stuck-state class. `context.setOffline` does not drop an open WebSocket (round 3, Playwright 1.62/1.66), so the socket is cut on the move frame instead. Before A's page loads:

```js
let dropMove = false;
await A.routeWebSocket(/\/ws$/, (ws) => {
  const srv = ws.connectToServer();
  ws.onMessage((m) => {
    if (dropMove && JSON.parse(String(m)).t === 'move') { dropMove = false; ws.close(); return; }
    srv.send(m);
  });
});
```

Set `dropMove = true` on A's autoConfirm turn; after the window lapses the client reconnects (same-seq state). Within 15 s A must again show `button.undo-send` or a `✓` button and the turn must complete (seq grows) — otherwise throw `stuck: <what is visible>`. Break-check: delete the reset effect → (d) throws `stuck`. (e) Rejected-move class: route the same way but rewrite the move frame's first step `from` to an illegal value once; expect `✓` (paused) visible within 3 s and **no** second `move` frame sent automatically (count frames) — then clicking `✓` sends the correct move.
- [ ] **Step 7:** `npm run typecheck -w @nardy/web && npm run build; echo EXIT=$?` → 0. Live run in the session browser at 360: fresh profile shows both toggles ON; AI game auto-rolls, auto-sends after 1.2 s, undo inside the window works, cube AI game shows ×2 countdown then rolls; console clean.
- [ ] Commit the four files: `feat(web): auto-confirm with undo window, auto-roll with doubling countdown`.
- [ ] **Batch end (orchestrator):** `wrangler dev :8787` with T1 merged in the tree; `node e2e/online.e2e.cjs; echo EXIT=$?` → 0; break-check: `UNDO_MS = 0` → e2e (b) must fail; restore. Worker integration on :8787 → 0.

### Task 3: Move hints and stacks

**Files:** `apps/web/src/components/themes.ts`, `apps/web/src/components/Board.tsx`, `apps/web/src/components/geometry.ts`, create `apps/web/scripts/contrast.ts`, `e2e/online.e2e.cjs`.
**Produces:** `BoardTheme.hint: { fill: string; edge: string }`, `BoardTheme.dim: number`; `data-hint="movable" | "selected" | "target" | "target-off"` attributes on hint groups; `STACK_H = 290` in `geometry.ts`.

Starting values (all 15 pairs ≥ 3 by max(fill, edge), review-verified):

| theme | hint.fill | hint.edge | dim |
|---|---|---|---|
| wood | `#ffd34d` | `#1f1206` | 0.55 |
| minimal | `#ffe600` | `#0b0f18` | 0.5 |
| malachite | `#ffd000` | `#08130f` | 0.55 |

Ring geometry (two-tone, edge band ≥ 2 CSS px at 360: horizontal scale 344/1000 = 0.344 px/unit → 6 units per side): edge stroke width = fill width + 12.

- [ ] **Step 1: failing check** — `apps/web/scripts/contrast.ts`:

`geometry.ts` imports values from `@nardy/core` (extensionless re-exports) and cannot be loaded by `node --experimental-strip-types` (`ERR_MODULE_NOT_FOUND`, verified round 2). So the hint widths live in `themes.ts` (type-only imports, loads fine):

```ts
import { THEMES, HINT_FILL_W, HINT_EDGE_W } from '../src/components/themes.ts';
const lum = (h: string) => { const n = parseInt(h.slice(1, 7), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const fails: string[] = []; let checked = 0;
for (const [name, th] of Object.entries(THEMES)) {
  for (const [bgName, bg] of Object.entries({ field: th.field, pointA: th.pointA, pointB: th.pointB, white: th.white.base, black: th.black.base })) {
    checked++;
    const best = Math.max(ratio(th.hint.fill, bg), ratio(th.hint.edge, bg));
    if (best < 3) fails.push(`${name}: hint vs ${bgName} ${bg} = ${best.toFixed(2)}`);
  }
}
const bandPx = ((HINT_EDGE_W - HINT_FILL_W) / 2) * (344 / 1000);
if (bandPx < 2) fails.push(`edge band ${bandPx.toFixed(2)} px at 360 < 2`);
console.log(`checked ${checked} pairs (expected 15), edge band ${bandPx.toFixed(2)} px`);
if (checked !== 15 || fails.length) { console.error(fails.join('\n')); process.exit(1); }
```

`themes.ts` gets `export const HINT_FILL_W = 5; export const HINT_EDGE_W = 17;` (band 6 units = 2.06 px). Before Step 2: `node --experimental-strip-types apps/web/scripts/contrast.ts; echo EXIT=$?` → non-zero (no `hint`).
- [ ] **Step 2:** add `hint`, `dim` to `BoardTheme` and themes; re-run → `checked 15 pairs`, EXIT=0. Break-checks: wood `hint.edge = '#d9b07a'` → fails naming `wood: hint vs`; `HINT_EDGE_W = 9` → fails naming `edge band`; restore both.
- [ ] **Step 3: stacks** (`geometry.ts`):

```ts
export const STACK_H = 5 * 2 * R; // 290
export function stackSpacing(n: number): number {
  if (n <= 5) return R * 2;
  return (STACK_H - R * 2) / (n - 1);
}
```

Bar: `barPos(mine, k, n)` gains `n`; spacing `n <= 5 ? 26 : Math.min(26, (BOTTOM - MID_Y - 48 - R - 4) / (n - 1))` (call site in `Board.tsx` passes `list.length`). Check (bundled, because of the core import):

```bash
S=/private/tmp/claude-501/-Users-oleksandrkhaliavinskyi-Projects-Backgammon/61d9f5a6-efcb-4fb2-98d5-68a02affe9f5/scratchpad
npx esbuild apps/web/src/components/geometry.ts --bundle --format=esm --platform=node --outfile=$S/geom.mjs && node -e "import('$S/geom.mjs').then(g=>{const bad=[];for(let n=1;n<=15;n++){const h=g.stackSpacing(n)*(n-1)+2*g.R;if(h>290.0001)bad.push('point n '+n+' height '+h.toFixed(1));const b=g.barPos(true,n-1,n).y+g.R;if(b>g.BOTTOM)bad.push('bar n '+n+' bottom '+b.toFixed(1))}if(bad.length){console.error(bad.join('\n'));process.exit(1)}console.log('stacks ok 1..15')})"; echo EXIT=$?
```

Expected `stacks ok 1..15`, EXIT=0. On today's code it fails with `point n 6 height 320` (verified round 2). (After T5 the same check runs for `geom(660)`.)

In `Board.tsx`, a checker that is not `top` in a stack with `count > 5` renders only the outer disc (`<circle r={R} .../>`), no inner rings; the top checker renders full and, when `count > 5`, the count text at `fontSize="26"` with `y="0" dominantBaseline="central"`.
Selected checker "lift" (spec C): a second shadow filter `${id}-lift` (`dy=8 stdDeviation=5`) used instead of `-shadow` on the selected checker; no positional offset.
- [ ] **Step 4: hints** (`Board.tsx`):

```tsx
{movable && !selected && (
  <g data-hint="movable">
    <circle r={R - 3} fill="none" stroke={th.hint.edge} strokeWidth={HINT_EDGE_W} />
    <circle r={R - 3} fill="none" stroke={th.hint.fill} strokeWidth={HINT_FILL_W} />
  </g>
)}
{selected && (
  <g data-hint="selected">
    <circle r={R - 3} fill="none" stroke={th.hint.edge} strokeWidth={HINT_EDGE_W + 4} />
    <circle r={R - 3} fill="none" stroke={th.hint.fill} strokeWidth={HINT_FILL_W + 4} />
  </g>
)}
```

Ring sits on the checker rim: outer radius (R − 3) + 17/2 = 34.5 < 35 = PW − R (gap to a neighbour column's checker edge), so rings never cover neighbours; the selected ring (36.5) may touch by 1.5 units — accepted.

Dimming on the checker `<g>`: `opacity: p.hints && p.mover === c.color && p.movable.size > 0 && !(c.top && p.movable.has(c.loc)) ? th.dim : 1`.
Targets: `<g data-hint="target">` = point path with two-tone outline (`stroke={th.hint.edge} strokeWidth={HINT_EDGE_W}` under `stroke={th.hint.fill} strokeWidth={HINT_FILL_W}`, `fill="none"`) + ghost checker at the landing spot `checkerPos(slot, n, n + 1)` where `n` = checkers already there (today's `Math.min(n, 4)` lands on checker 4 for n ≥ 5) (`fill` = checker gradient, `opacity 0.45`, two-tone ring). Dimming uses the `movable` set captured when the dice were rolled for the turn (`dimSet` from `legal` while `!busy`, kept during `busy`) so it does not flicker between steps. Tray: `<g data-hint="target-off">` two-tone rect. Remove all `className="pulse"` from hint marks.
- [ ] **Step 5: e2e selectors** — `playTurn` uses `[data-hint="target"]`, `[data-hint="target-off"]`, `[data-hint="movable"]` instead of `.pulse`. The pips-changed assert from T2 is the gate: with selectors broken it must fail (break-check: rename `data-hint="movable"` → fails with pip numbers).
- [ ] **Step 6:** typecheck + build → 0. Live run 360/768/1440 × three themes, own turn after roll: print per theme `movable rings = N, expected = movable.size` (count `[data-hint="movable"]`), selected target count vs `dests.size`, a stack of ≥ 6 rendered height via `getBBox` ≤ 290. Screenshots to the batch report.
- [ ] Commit five files: `feat(web): two-tone move hints, capped stacks with count`.
- [ ] **Batch end:** e2e → EXIT=0.

### Task 4: Rejoin screen

**Files:** `apps/web/src/screens/Room.tsx`, `e2e/online.e2e.cjs`.
**Consumes:** `info().seatsOffline`, `info().offlineName` (T1), `T.rejoinAs`, `T.rejoin`, `T.badPassword` (exists).

- [ ] **Step 1:** place `full`/`noSeat`/`rejoin`/`ready`/`helloName` right after `hasToken` (`Room.tsx:35`) and before any early return (hooks unconditional; earlier placement hits TDZ — round 2). Remove the old `name` line at `:18` and the old `ready` at `:36`.

```ts
interface Info { exists: boolean; hasPassword?: boolean; seatsTaken?: number; seatsOffline?: number; offlineName?: string | null }
const full = !hasToken && info?.seatsTaken === 2;
const noSeat = full && !info?.seatsOffline;
const rejoin = full && !!info?.seatsOffline;
const ready = info?.exists && !noSeat && (hasToken || (!info.hasPassword && !rejoin) || password !== null);
const helloName = useSettings((s) => s.name) || (rejoin && info?.offlineName) || T.you;
```

`RemoteController` gets `helloName` instead of `name`.
- [ ] **Step 2: render** — `noSeat` → existing room-full screen (no password prompt). `rejoin && (!ready || fatal === 'bad_password')` → form: title `{T.rejoinAs} {info.offlineName}`, `T.badPassword` line when `fatal === 'bad_password'`, password input only if `info.hasPassword`, submit button `T.rejoin`; `onSubmit`: `setFatal(null); setPassword(info.hasPassword ? pwInput : '')`.
- [ ] **Step 3: e2e** — after the online game section: password room A+B, B's context closed; fresh context C opens the link → expects text `Вернуться в игру как Борис`, enters a wrong password → `Неверный пароль`, then the right one → game screen (score header visible); A's opponent bar has no `не в сети` tag within 3 s. Then: both online, fresh context D → `Комната заполнена` with no password input on the page.
- [ ] **Step 4:** typecheck + build → 0; e2e → EXIT=0 (batch end). Break-check: make `rejoin` always `false` → step 3 fails naming the missing text.
- [ ] Commit two files: `feat(web): rejoin screen for an offline seat`.

### Task 5: Vertical board and compact phone chrome

**Files:** `apps/web/src/components/geometry.ts`, `apps/web/src/components/Board.tsx`, `apps/web/src/screens/Game.tsx`, `apps/web/src/styles.css`, `e2e/online.e2e.cjs`.
**Produces:** `geom(cross: 800 | 660)` in `geometry.ts` returning `{ VB_H, TOP, BOTTOM, MID_Y, POINT_LEN, checkerPos, offPos, barPos, locAt }`; `BoardProps.vertical: boolean`; `useVertical()` in `Game.tsx` = `matchMedia('(orientation: portrait) and (max-width: 767px)')` with a change listener.

Mapping (clockwise rotation, cross axis H = 660): board `(x, y)` → screen `(H − y, x)`; SVG `transform="matrix(0 1 -1 0 660 0)"`, `viewBox="0 0 660 1000"`. Inverse: `x = Y, y = 660 − X`. Viewer's row (bottom, y = 636) → left column; home (slots 0-5, x 468-852) → lower-left; tray → bottom strip; bar → horizontal strip at screen y 408-468. Inverse mismatches over 1e5 random points: 0 (computed). Corner mapping may be replaced by the approved design.

- [ ] **Step 1: geometry** — move `VB_H`-dependent constants into `geom(cross)`; horizontal callers use `geom(800)` (values identical to today: `TOP 24, BOTTOM 776, MID_Y 400, POINT_LEN 320`); vertical `geom(660)`: `TOP 24, BOTTOM 636, MID_Y 330, POINT_LEN 280`. Check: `STACK_H 290 < (BOTTOM − TOP)/2 = 306`. Point-number text y uses `g.TOP - 7` / `g.BOTTOM + 17`.
- [ ] **Step 2: Board** — wrap everything after `<Defs>` in `<g transform={p.vertical ? 'matrix(0 1 -1 0 660 0)' : undefined}>`; viewBox per mode. `toSvg`:

```ts
const X = ((e.clientX - r.left) / r.width) * (p.vertical ? 660 : VB_W);
const Y = ((e.clientY - r.top) / r.height) * (p.vertical ? VB_W : 800);
return p.vertical ? { x: Y, y: 660 - X } : { x: X, y: Y };
```

Text upright: point numbers `transform={p.vertical ? `rotate(-90 ${x} ${y})` : undefined}`; stack count inside the checker group `transform={p.vertical ? 'rotate(-90)' : undefined}`. Shadow filter: `dx={p.vertical ? 3 : 0} dy={p.vertical ? 0 : 3}` — under `matrix(0 1 -1 0 660 0)` a local vector (3, 0) maps to screen (0, 3), i.e. down.
- [ ] **Step 3: CSS** — `Game.tsx` sets `className={'board-wrap' + (vertical ? ' vertical' : '')}` and passes `vertical` to `BoardView`. Then:

```css
.board-wrap.vertical { aspect-ratio: 660 / 1000; width: min(100%, calc((100dvh - 120px) * 0.66)); --die: 8cqw; }
/* dice live in the bar strip (screen y 408–468 of 1000 → centre 43.8%); 8cqw = 52.8 units < 60 bar */
.board-wrap.vertical .dice-tray, .board-wrap.vertical .dice-tray.single { top: 43.8%; }
.board-wrap.vertical .dice-tray.right { left: 75%; }
.board-wrap.vertical .dice-tray.left { left: 25%; }
.board-wrap.vertical .center-actions { top: 72%; left: 50%; }
.board-wrap.vertical .toast { top: 30%; left: 50%; }
.board-wrap.vertical .ck.dragging { filter: drop-shadow(10px 0 8px rgba(0, 0, 0, 0.45)); } /* local +x = screen down */
.board-wrap.vertical .cup-layer { left: 50%; top: 72%; }
```

Modals are full-screen layers — unchanged. Dice trays at 25%/75% may overlap ≥ 3 bar checkers in the short variant (visual only, `pointer-events: none`) — design step decides.
- [ ] **Step 4: chrome** (`Game.tsx`, vertical only): header row `← · score · opponent name + offline tag + clock · 💬`; opponent `.pbar` not rendered; `data-pips="me"` / `"opp"` kept on compact pip text; bottom row `own name + clock · status · ⋯ (T.more)`; `⋯` toggles a sheet with the emoji bar and `⚑ Resign`; `.emoji-bar`, `.controls` resign hidden in the main column. Undo-send and ×2 buttons stay visible in the bottom row.
- [ ] **Step 5: measurement gate** — in the session browser print, per theme, at 360×780: `board.height/innerHeight` (≥ 0.65) and checker diameter `document.querySelector('g.ck circle').getBoundingClientRect().width` (≥ 30); at 768×1024 assert no `.board-wrap.vertical` (horizontal expected); at 1440×900 the same. Print values even when passing. Plus a geometry gate that names offenders: every `g.ck` element's `getBoundingClientRect()` lies inside the svg's rect — print `checkers outside board: <ids or none>` for the opening position and for a position with a 15-stack (local hot-seat game where possible, else the opening). Break-checks: CSS `aspect-ratio: 800/1000` in vertical → ratio 0.551, gate red naming the number; `geom(800)` in vertical → "checkers outside board" lists ids. Re-run the Task 3 stacks check for `geom(660)`.
- [ ] **Step 6: input** — at 360: tap the centre of a `[data-hint="movable"]` ring's `getBoundingClientRect()`, then a `[data-hint="target"]` ghost → pending pip count changes; drag one checker to a target → lands. Rotate `toSvg` wrong on purpose (swap X/Y) → this check fails; restore.
- [ ] **Step 7:** typecheck + build → 0; e2e → 0 (M2 runs at 1100×900, horizontal; shake phone scenario now vertical — its selectors `.dice-tray:not(.single) .die-wrap` are layout-independent).
- [ ] Commit five files (incl. `e2e/online.e2e.cjs` if selectors needed changes): `feat(web): vertical board and compact chrome on portrait phones`.

---

## Final verification

- `npm run typecheck && npm test; echo EXIT=$?` → 0; worker integration on `wrangler dev` → 0; e2e → 0 (exit code of `node`, not of a pipe).
- Live run per spec checklist: 360/768/1440, three themes, own/opponent turn, roll, ×2 countdown, undo window, stack of 10, rejoin both paths, console without new errors.
- Compare with the approved design screens at the same widths; name every mismatch.

## Review log

Round 1 (Opus, fresh context, 2026-11-15) — all accepted: P0 unreachable 90% height → cross axis 660 + reachable thresholds; P1 e2e selectors silently green → `data-hint` + throwing asserts; P1 batch-1 e2e vs worker edits → e2e at batch end, T1 on :8788; P2 codex without network → T1 to Sonnet; P2 undo after send → `sent` flag, one undo button; P2 auto-selected tap → condition dropped; P2 edge band too thin → width gate in the script; P2 rejoin form (`setFatal(null)`, name, e2e owner); P2 mirror vs rotation → rotation; P2 design step → pipeline position; P3 TS style, unused key, line refs, break-check by name, double-click race.

Round 2 (Opus, fresh context) — all accepted: P1 `sent` used before declaration → declared above `canInteract`; P1 strip-types cannot load `geometry.ts` → widths in `themes.ts`, stacks check via esbuild bundle; P2 stuck flags after dropped send (class) → reset on `[m, g.error, g.conn]` + e2e offline check (d); P2 mid-turn undo lost → plain undo outside the window; P2 tap-to-move order → after `dests`; P2 auto-roll gate green with opening dice → `:not(.single)`; P2 undo pip expectation → value before last tap; P2 M2 vs vertical chrome → 1100×900 viewport + `data-pips`, T5 owns e2e; P2 T5 break-check could not go red → CSS break + checkers-outside gate; P2 dice over checkers in vertical → dice in bar strip. P3: bar stack cap + check, count text centring, lift as shadow, dragging shadow, offline tag in chrome, Room.tsx placement, ring radius, `.vertical` class step; name leak and dead-token prompt accepted as ceilings.

Round 3 (Opus, fresh context) — 0 P0/P1; rounds 1-2 fixes confirmed by execution (T1 3 failed → 8 passed; T2 code tsc 0; stacks check red→green; contrast break-checks named). Accepted: P2 e2e (d) green without the fix (`setOffline` keeps WebSockets) → `routeWebSocket` cut + break-check; P2 rejected move auto-resent / identical error stuck → `paused` flag, error cleared before send, e2e (e). P3: `dist` before wrangler, ghost position, `.cup-layer`, T5 file list, dim flicker. P3 accepted as is: undo-send flicker if an unrelated same-seq state arrives after submit (duplicate send only if the server takes > 1.2 s; server rejects it).
