# Mobile turn UX, move hints, vertical board, room rejoin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement spec `docs/superpowers/specs/2026-11-15-mobile-ux-rejoin-design.md`: auto-confirm with an undo window, auto-roll with a doubling countdown, visible per-theme move hints, a vertical board on portrait phones, and rejoining a full room into an offline seat.

**Architecture:** Server change is confined to `RoomDO` (`info()` + `onHello`). Client turn flow stays in `Game.tsx`; hints live in `Board.tsx` + `themes.ts`; the vertical board is the same geometry under an SVG transpose (`matrix(0 1 1 0 0 0)`), with text counter-transposed and pointer coords swapped.

**Tech Stack:** React 19 + Vite, zustand 5.1.0 (`persist` with `version`/`migrate`, verified in `node_modules/zustand/middleware/persist.d.ts`), Cloudflare Workers + Durable Objects (wrangler 4), vitest 5, Playwright (e2e, run via npx cache).

## Global Constraints

- Defaults: `autoConfirm=true`, `autoRoll=true`; settings toggles stay.
- Undo window after a finished turn: **1200 ms**. Doubling countdown before auto-roll: **2000 ms**. Auto-roll delay: **450 ms**.
- Hint contrast: every hint mark ≥ **3:1** against `field`, `pointA`, `pointB`, both checker bases (WCAG 1.4.11).
- Vertical board: portrait **and** viewport width < **768 px**. Board ≥ **90%** of usable height at 360×780.
- Rejoin: only into a seat with `disconnectedAt !== null`; password still required if the room has one; old token stops matching.
- Verification widths: 360, 768, 1440; themes: wood, minimal, malachite.

## Readers of changed shared fields (Frame rule)

| Field | Readers (all must stay correct) |
|---|---|
| `Settings.autoRoll/autoConfirm` defaults + persist version | `screens/Game.tsx:180,221`, `screens/Menus.tsx:312-313`, `e2e/online.e2e.cjs:7` (writes `version: 0` — after migration it would flip autoRoll to `true` and break the shake scenario at `:95-112`) |
| `RoomInfo` (`info()` response) | `screens/Room.tsx` `Info` interface, `worker/test/integration.test.ts:54` (`toMatchObject`, extra fields OK), `:162` (`toEqual({ exists: false })` — must stay exactly that for missing rooms), `:178` |
| `onHello` `room_full` branch | `remote.ts` `onFatal('room_full')`, `Room.tsx` full screen, test `:79-80` (both online → still `room_full`) |
| `BoardTheme` keys | `Board.tsx` only (`grep -n "th\.\|THEMES" apps/web/src`) |

## Known ceiling (accepted)

- ponytail: a creator who lost their token while the room is still **waiting** joins as seat 1 against their own offline seat 0 (no free-vs-reclaim choice). Upgrade path: show "take seat as <name>" vs "join as opponent" when `status === 'waiting'`.
- ponytail: in a passwordless room anyone with the link can take an offline seat (owner accepted).

---

## Batch map

Web tasks run `tsc -p apps/web` and `vite build`, which read every web file — so **no two web tasks share a batch**.

| Batch | Task | Owner files (write) | Reads | Model |
|---|---|---|---|---|
| 0 | T0 i18n strings | `apps/web/src/lib/i18n.ts` | — | orchestrator (Opus) |
| 1 | T1 server rejoin | `worker/src/room.ts`, `worker/test/integration.test.ts` | `@nardy/core` | GPT-5.6-Sol (codex) |
| 1 | T2 turn flow (auto-confirm/undo, auto-roll/double, one-target tap, settings migration, e2e settings) | `apps/web/src/screens/Game.tsx`, `apps/web/src/lib/settings.ts`, `apps/web/src/styles.css`, `e2e/online.e2e.cjs` | web package | orchestrator (Opus) |
| 2 | T3 move hints | `apps/web/src/components/Board.tsx`, `apps/web/src/components/themes.ts`, `apps/web/scripts/contrast.ts` (new) | web package | Sonnet |
| 3 | T4 rejoin screen | `apps/web/src/screens/Room.tsx` | T1 `info()` fields, web package | Sonnet |
| 4 | T5 vertical board + compact phone chrome | `apps/web/src/components/geometry.ts`, `apps/web/src/components/Board.tsx`, `apps/web/src/screens/Game.tsx`, `apps/web/src/styles.css` | web package | orchestrator (Opus) |
| end | Review rounds: flagship reviewers until zero P0-P2, then full diff → codex GPT-6-Astra-Medium | read-only | | |

Batch 1 pairs a worker task with a web task: disjoint files, disjoint typecheck projects (`worker/tsconfig.json` does not include `apps/web`).
Before every codex dispatch: `< /dev/null`, echo-probe of 3 values from this plan, `node_modules` present in the worktree.

---

### Task 0: i18n strings

**Files:** Modify `apps/web/src/lib/i18n.ts` (ru block near `:46-60`, en block near `:177-191`).

**Produces:** keys `T.rejoinAs` (`'Вернуться в игру как'` / `'Rejoin as'`), `T.rejoin` (`'Вернуться'` / `'Rejoin'`), `T.autoSending` (`'Ход отправляется…'` / `'Sending move…'`), `T.more` (`'Ещё'` / `'More'`).

- [ ] Add the four keys to both language objects next to `roomFull`.
- [ ] `npm run typecheck -w @nardy/web` → exit 0 (the `en` object is typed by `ru` keys, so a missing key fails here).
- [ ] Commit `apps/web/src/lib/i18n.ts` only: `feat(web): strings for rejoin, auto-send, more menu`.

### Task 1: Server — rejoin into an offline seat

**Files:** Modify `worker/src/room.ts` (`RoomInfo` `:59-66`, `info()` `:110-121`, `onHello` `:174-212`); Test `worker/test/integration.test.ts`.

**Produces:** `RoomInfo.seatsOffline?: number`, `RoomInfo.offlineName?: string | null`. Reclaim rule: seat to take = first `c in [0,1]` with `seats[c] && seats[c].disconnectedAt !== null`.

- [ ] **Step 1: failing tests** — append to `describe('hardening')`:

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

it('both online: no token → room_full, info says 0 offline', async () => {
  const { id } = await fullRoom('pw');
  expect(await info(id)).toMatchObject({ seatsTaken: 2, seatsOffline: 0, offlineName: null });
  const c = new Client(); await c.open(id); c.send({ t: 'hello', name: 'Eve', password: 'pw' });
  expect(await c.wait((m) => m.t === 'error')).toMatchObject({ code: 'room_full' });
});

it('offline seat: no token + right password → takes the seat, old token dead', async () => {
  const { id, b, wb } = await fullRoom('pw');
  b.ws.close(); await settle();
  expect(await info(id)).toMatchObject({ seatsOffline: 1, offlineName: 'Bob' });
  const c = new Client(); await c.open(id); c.send({ t: 'hello', name: 'Bob2', password: 'pw' });
  const w = (await c.wait((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
  expect(w.you).toBe(1);
  expect(w.token).not.toBe(wb.token);
  c.ws.close(); await settle();
  const old = new Client(); await old.open(id); old.send({ t: 'hello', name: 'Bob', token: wb.token, password: 'nope' });
  expect(await old.wait((m) => m.t === 'error')).toMatchObject({ code: 'bad_password' });
});

it('offline seat: wrong password → bad_password, seat untouched', async () => {
  const { id, b } = await fullRoom('pw');
  b.ws.close(); await settle();
  const c = new Client(); await c.open(id); c.send({ t: 'hello', name: 'Eve', password: 'x' });
  expect(await c.wait((m) => m.t === 'error')).toMatchObject({ code: 'bad_password' });
  expect(await info(id)).toMatchObject({ seatsOffline: 1, offlineName: 'Bob' });
});
```

- [ ] **Step 2: run, expect FAIL** — `cd worker && npx wrangler dev --port 8787` (background), then `cd worker && NARDY_URL=http://127.0.0.1:8787 npx vitest run test/integration.test.ts; echo EXIT=$?` → test 1 fails on `seatsOffline` undefined, test 2 fails with `room_full`. Record the failing assertion names.
- [ ] **Step 3: implement**

```ts
// RoomInfo: add
  seatsOffline?: number;
  offlineName?: string | null;

// in RoomDO
  private offlineSeat(): Color | null {
    const s = this.s!;
    for (const c of [0, 1] as Color[]) if (s.seats[c] && s.seats[c]!.disconnectedAt !== null) return c;
    return null;
  }

// info(): add to the exists:true object
      seatsOffline: s.seats.filter((x) => x && x.disconnectedAt !== null).length,
      offlineName: (() => { const c = this.offlineSeat(); return c === null ? null : s.seats[c]!.name; })(),

// onHello, replace the `free === null` branch:
      const free = s.seats[0] === null ? 0 : s.seats[1] === null ? 1 : this.offlineSeat();
      if (free === null) {
        this.send(ws, { t: 'error', code: 'room_full' });
        return ws.close(4403, 'room_full');
      }
      seat = free;
      s.seats[seat] = { name, token: randomToken(), disconnectedAt: null };
```

Note: the password check already runs before `free` for every token-less hello, so reclaim inherits it. `s.seats[seat] = {...}` replaces the token → the old one no longer matches. A reclaim must not restart the match: `!s.match && s.seats[0] && s.seats[1]` is already false when a match exists.
Edge: a reclaim when a seat is null cannot happen (null seat wins first).

- [ ] **Step 4: run → PASS**, plus the whole file (existing tests at `:79-80`, `:162` unchanged). `echo EXIT=$?` must print 0.
- [ ] **Step 5: gate check by breaking** — temporarily revert `this.offlineSeat()` in `free` to `null`; test 2 must go red; restore.
- [ ] **Step 6:** `npm run typecheck -w @nardy/worker` → 0. Commit `worker/src/room.ts worker/test/integration.test.ts`: `feat(worker): rejoin a full room into an offline seat`.

### Task 2: Turn flow — auto-confirm with undo window, auto-roll with doubling countdown, one-target tap, settings migration

**Files:** `apps/web/src/lib/settings.ts`, `apps/web/src/screens/Game.tsx`, `apps/web/src/styles.css`, `e2e/online.e2e.cjs`.

**Produces:** CSS class `.countdown` (a bar that empties via `animation-duration` = inline `--ms`). `Game.tsx` local consts `UNDO_MS = 1200`, `DOUBLE_MS = 2000`.

- [ ] **Step 1: settings migration** in `settings.ts`:

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

Check: in the browser, `localStorage.setItem('nardy.settings', '{"state":{"autoRoll":false,"autoConfirm":false},"version":0}')`, reload, Settings screen shows both toggles ON; toggle off, reload, they stay OFF (version is now 1).

- [ ] **Step 2: undo window** — replace the `autoConfirm` effect (`Game.tsx:179-184`):

```ts
const UNDO_MS = 1200;
const [sendAt, setSendAt] = useState<number | null>(null);
useEffect(() => {
  if (!(turnDone && pending && pending.chains.length > 0 && st.autoConfirm && !busy)) { setSendAt(null); return; }
  setSendAt(Date.now() + UNDO_MS);
  const id = setTimeout(submit, UNDO_MS);
  return () => clearTimeout(id);
}, [turnDone, pending, st.autoConfirm, submit, busy]);
```

`undo()` changes `pending` → effect cleanup cancels the timer; after a new finish the window restarts. In the controls row, when `sendAt` is set and `st.autoConfirm`: render

```tsx
<button className="btn primary undo-send" onClick={undo}>
  ↶ {T.undo}
  <i className="countdown" style={{ ['--ms' as string]: `${UNDO_MS}ms` }} key={sendAt} />
</button>
```

and hide the `✓ Done` button when `st.autoConfirm`.

- [ ] **Step 3: auto-roll + doubling countdown** — replace the auto-roll effect (`Game.tsx:220-225`):

```ts
const DOUBLE_MS = 2000;
useEffect(() => {
  if (!rollActor || !st.autoRoll) return;
  const id = setTimeout(doRoll, mayDouble ? DOUBLE_MS : 450);
  return () => clearTimeout(id);
}, [rollActor, st.autoRoll, mayDouble, doRoll, m.seq]);
```

Roll prompt block (`Game.tsx` `{rollActor && !shaking && ...}`): when `st.autoRoll`, render only the `×2 Double` button (if `mayDouble`) with `<i className="countdown" style={{'--ms': '2000ms'}} />`; the `🎲 Roll` button, shake hint and enable-shake button render only when `!st.autoRoll`. Shake listener effect gets `!st.autoRoll` in its guard. `onLocClick`'s `if (rollActor && !mayDouble) return doRoll();` stays only for `!st.autoRoll`.

- [ ] **Step 4: one-target tap** — in `onLocClick` before `setSelected`:

```ts
if (movable.has(loc) && selected !== loc && pending && mover !== null) {
  const ds = destinationsFrom(pending.ts, locToPos(loc, mover), memoRef.current);
  if (ds.length === 1) return playChain(ds[0].steps);
}
```

- [ ] **Step 5: CSS** in `styles.css` after `.controls .status`:

```css
.countdown { position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: currentColor; opacity: .55; transform-origin: left; animation: countdown var(--ms) linear forwards; }
@keyframes countdown { to { transform: scaleX(0); } }
.undo-send, .center-actions .btn.gold { position: relative; overflow: hidden; }
```

Add `.countdown` to the existing `prefers-reduced-motion` block with `animation: none; opacity: 0;`.

- [ ] **Step 6: e2e settings** — `e2e/online.e2e.cjs:7`: set `version: 1` and keep `autoRoll: false` (the shake scenario needs it); add a second phone context `M2` with `autoRoll: true, autoConfirm: true` asserting: no `button:has-text("Бросить")` within 1500 ms of its turn and dice appear (`.die-wrap` count 2); after its last checker move a `button.undo-send` is visible, clicking it brings the checker back (board text differs), letting it lapse sends the move (opponent's `state.seq` grows).
- [ ] **Step 7:** `npm run typecheck -w @nardy/web && npm run build` → 0. Live run in the session browser: AI game at 360 width, both toggles default ON from a fresh profile; turn auto-sends after 1.2 s; undo within the window works; cube-enabled AI game shows the ×2 countdown, then rolls.
- [ ] **Step 8: break-check** — set `UNDO_MS = 0` → the e2e undo assertion must go red; restore.
- [ ] Commit the four files: `feat(web): auto-confirm with undo window, auto-roll with doubling countdown`.

### Task 3: Move hints per theme

**Files:** `apps/web/src/components/themes.ts`, `apps/web/src/components/Board.tsx`, create `apps/web/scripts/contrast.ts`.

**Produces:** `BoardTheme.hint: { fill: string; edge: string }`, `BoardTheme.dim: number` (opacity for non-movable own checkers). Values come from the approved design screens; starting values (contrast-checked 2026-11-15, two-tone so one tone always clears 3:1 against light **and** dark points):

| theme | hint.fill | hint.edge | dim |
|---|---|---|---|
| wood | `#ffd34d` | `#1f1206` | 0.55 |
| minimal | `#ffe600` | `#0b0f18` | 0.5 |
| malachite | `#ffd000` | `#08130f` | 0.55 |

- [ ] **Step 1: failing check** — `apps/web/scripts/contrast.ts`:

```ts
import { THEMES } from '../src/components/themes.ts';
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
console.log(`checked ${checked} pairs (expected 15)`);
if (checked !== 15 || fails.length) { console.error(fails.join('\n')); process.exit(1); }
```

Run `node --experimental-strip-types apps/web/scripts/contrast.ts; echo EXIT=$?` → fails (no `hint` key yet → throws) — EXIT≠0.
- [ ] **Step 2:** add `hint`, `dim` to `BoardTheme` and the three themes (table above); drop `highlight`/`target` uses in Board for hints (keep `highlight` for last-move marker). Re-run → `checked 15 pairs`, EXIT=0. Break-check: set wood `hint.edge` to `#d9b07a` → must fail naming `wood: hint vs field`; restore.
- [ ] **Step 3: Board rendering** (`Board.tsx` checker loop and targets):

```tsx
// movable top checker: two-tone solid ring, no pulse
{movable && !selected && (<>
  <circle r={R + 3} fill="none" stroke={th.hint.edge} strokeWidth="7" />
  <circle r={R + 3} fill="none" stroke={th.hint.fill} strokeWidth="4" />
</>)}
{selected && (<>
  <circle r={R + 4} fill="none" stroke={th.hint.edge} strokeWidth="10" />
  <circle r={R + 4} fill="none" stroke={th.hint.fill} strokeWidth="6" />
</>)}
// dimming: on the checker <g>, when p.hints && p.mover === c.color && p.movable.size > 0 && !(c.top && p.movable.has(c.loc))
style={{ ..., opacity: dimmed ? th.dim : 1 }}
// selected lift: translate(x, y - 6) when selected
```

Targets: whole point `path` with `fill={th.hint.fill}` `opacity="0.28"` + `stroke={th.hint.edge}` `strokeWidth="2"`; ghost checker at the landing spot: `<circle r={R} fill={`url(#${uid}-ck-${p.mover === 0 ? 'white' : 'black'})`} opacity="0.45" />` + `<circle r={R} fill="none" stroke={th.hint.fill} strokeWidth="3" />`. Tray target: same two-tone rect. Remove `className="pulse"` from hint marks.
- [ ] **Step 4:** typecheck + build → 0; live run at 360/768/1440 in all three themes: own turn after roll — name per theme which checkers carry the ring (count must equal `movable.size`, read via `document.querySelectorAll` on a `data-hint="movable"` attribute added to the ring group) and that targets show a ghost. Screenshots attached to the batch report.
- [ ] Commit three files: `feat(web): two-tone move hints with per-theme contrast check`.

### Task 4: Rejoin screen

**Files:** `apps/web/src/screens/Room.tsx`.
**Consumes:** `info().seatsOffline`, `info().offlineName` (Task 1), `T.rejoinAs`, `T.rejoin` (Task 0).

- [ ] **Step 1:** extend `Info` with `seatsOffline?: number; offlineName?: string | null`. Compute:

```ts
const full = !hasToken && info?.seatsTaken === 2;
const noSeat = full && !info?.seatsOffline;
const rejoin = full && !!info?.seatsOffline;
const ready = info?.exists && !noSeat && (hasToken || (!info.hasPassword && !rejoin) || password !== null);
```

- [ ] **Step 2:** render order: `noSeat` → existing "room full" screen (no password prompt). `rejoin && !ready` → form titled `{T.rejoinAs} {info.offlineName}` with the password field only when `info.hasPassword`; submit sets `password` to the input (or `''` for passwordless) → `ready` → controller connects → server reclaims.
- [ ] **Step 3:** typecheck + build → 0. Live check (two browser contexts against `wrangler dev`): reproduce the original bug path — A+B in a password room, B closes; fresh context C opens the link → sees "Вернуться в игру как Bob", enters password → lands in the game as seat 1; A's bar shows Bob online. Second path: both online, fresh context → "Комната заполнена" immediately, no password prompt.
- [ ] Commit: `feat(web): rejoin screen for an offline seat`.

### Task 5: Vertical board and compact phone chrome

**Files:** `apps/web/src/components/geometry.ts`, `apps/web/src/components/Board.tsx`, `apps/web/src/screens/Game.tsx`, `apps/web/src/styles.css`.

**Produces:** `BoardProps.vertical: boolean`; `useVertical()` hook in `Game.tsx` = `matchMedia('(orientation: portrait) and (max-width: 767px)')`.

Mapping: transpose `(x, y) → (y, x)`, viewBox `0 0 800 1000`. Viewer's row (bottom, slots 0-11) becomes the right column, home (slots 0-5) bottom-right, opponent row left column, bar a horizontal strip at y≈408-468, tray a bottom strip. Transpose is self-inverse.

- [ ] **Step 1:** `Board.tsx`: wrap everything after `<Defs>` in `<g transform={p.vertical ? 'matrix(0 1 1 0 0 0)' : undefined}>`; `viewBox={p.vertical ? `0 0 ${VB_H} ${VB_W}` : ...}`; `toSvg` when vertical:

```ts
const sx = ((e.clientX - r.left) / r.width) * VB_H;  // screen x spans board y (0..800)
const sy = ((e.clientY - r.top) / r.height) * VB_W;  // screen y spans board x (0..1000)
return p.vertical ? { x: sy, y: sx } : { x: ((e.clientX - r.left) / r.width) * VB_W, y: ((e.clientY - r.top) / r.height) * VB_H };
```

Ghost drag coordinates come from `toSvg`, so they are already in board space. Every `<text>` (point numbers, stack counts) gets a counter transform: point numbers `transform={p.vertical ? `translate(${x},${y}) matrix(0 1 1 0 0 0) translate(${-x},${-y})` : undefined}`; stack count text inside the checker group `transform={p.vertical ? 'matrix(0 1 1 0 0 0)' : undefined}`. Drop shadow filter: `dx`/`dy` swapped by passing `vertical` into `Defs` (`dx={vertical ? 3 : 0} dy={vertical ? 0 : 3}` — inside the transposed group this renders as a downward shadow).
- [ ] **Step 2:** `styles.css`: `.board-wrap.vertical { aspect-ratio: 800 / 1000; width: min(100%, calc((100dvh - 120px) * 0.8)); }`; dice: `.board-wrap.vertical .dice-tray { left: 50%; } .board-wrap.vertical .dice-tray.right { top: 66%; } .board-wrap.vertical .dice-tray.left { top: 21.6%; }` (left offsets map to top under transpose). `--die: 8cqw` in vertical.
- [ ] **Step 3:** `Game.tsx` compact chrome when vertical: header = `←`, score, opponent name+clock in one row (`.pbar` hidden for the opponent, its clock moves into the header); bottom row = own name+clock+status+`⋯`; `⋯` toggles a sheet with the emoji bar and `⚑ Resign`; `.emoji-bar` and resign hidden from the main column when vertical.
- [ ] **Step 4: measurement gate** (must name numbers): at 360×780 in the session browser, `document.querySelector('.board-svg').getBoundingClientRect().height / (innerHeight - safe areas)` printed per theme; must be ≥ 0.90. Print the value even when passing. Also at 768×1024 (portrait, ≥768 → horizontal board expected: assert `!document.querySelector('.board-wrap.vertical')`) and 1440×900.
- [ ] **Step 5: input check:** at 360 width, tap a movable checker and its target by coordinates from the rendered ring/ghost `getBoundingClientRect()` → the move lands (pending board changes). Drag a checker → lands. If the transpose of pointer coords is wrong this fails on the first tap.
- [ ] **Step 6:** typecheck + build → 0; e2e full run → exit 0 (read the node exit code, not a pipe's).
- [ ] Commit four files: `feat(web): vertical board and compact chrome on portrait phones`.

---

## Final verification (after Batch 4)

- `npm run typecheck && npm test` → 0; worker integration against `wrangler dev` → 0; e2e → 0.
- Live run per spec checklist: 360/768/1440, three themes, own turn, opponent turn, roll, double countdown, undo window, rejoin both paths, console has no new errors.
- Compare against the approved design screens at the same widths; name every mismatch.
