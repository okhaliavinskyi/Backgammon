# Screens Redesign Implementation Plan (v3, after final review round 2)

> **Execution:** Implement task-by-task, checking steps only after verification. Use the named superpowers workflow if installed; otherwise follow this document directly. Missing optional workflow skills must not block implementation.

**Status (2026-11-16):** Two plan-review rounds completed, as requested by the owner; round 2 had one Opus reviewer. All 13 final findings are incorporated below and indexed in `2026-11-16-screens-redesign-review-r2.md`. No third plan-review round. Implementation has **not** started in this checkout. Start with root `handover.md`; runtime results quoted from the reviewer are scratch-checkout evidence, not acceptance of this branch.

**Goal:** Redraw the four general screens (home, bot/local setup, online lobby, waiting room) and the game screen (phone and desktop) as approved on the design canvas, without touching game rules, protocol or the Worker.

**Architecture:** Client-only. New styles live in two new CSS files (`menus.css`, `game-hud.css`) imported by their screens. `main.tsx` is changed so `styles.css` is bundled **first** (today it is bundled after the screens, so it wins every tie) and the new rules also use higher specificity. Icons are one small inline-SVG module. The game HUD moves out of `Game.tsx` into `GameHud.tsx` and reuses the existing desktop CSS grid by re-assigning its areas. Acceptance = two Playwright gate scripts that name what they found (`found N, expected M`), run red on the base first.

**Tech Stack:** React 19, Vite 8, zustand, Playwright (from the npx cache, see Global Constraints), wrangler dev for live checks.

**Spec:** `docs/superpowers/specs/2026-11-15-screens-redesign-design.md`. **Canvas:** https://claude.ai/artifact/4VqvUkMd4pQ8eezACer2DB (private; the spec is the durable copy).

## Global Constraints

- `packages/core`, `worker/`, protocol files: **not touched**.
- Out of scope: move log, last-move line, «Сразу» + remembered params, open-room counter, board/checker/dice changes.
- Tap targets ≥ 44px on the screens this plan redraws; text contrast ≥ 4.5:1; no emoji as UI icons (reaction emoji sent to the opponent are content, not icons).
- Existing classes `.btn`, `.seg`, `.field`, `.card`, `.page-head`, `.icon-btn`, `.screen` are **not redefined by their own selector**; changes go through new class names or compound selectors in the new CSS files (see the PageHead reader list in Task 2).
- Cascade: in `apps/web/src/main.tsx` the import of `./styles.css` must come **before** `import { App } from './App'` (Task 1 Step 5). New rules additionally use ≥ the specificity of the rule they override (`.game .x` over `.x`).
- Canonical e2e environment (verified by two reviewers on the merged base):
  ```bash
  export NODE_PATH=$HOME/.npm/_npx/9833c18b2d85bc59/node_modules   # playwright 1.66-alpha
  export NARDY_URL=http://127.0.0.1:8787
  ```
  Playwright is launched with `{ channel: 'chrome' }` (the bundled headless shell is not installed). **Read exit codes from the script itself**: `node x.cjs > out.txt; echo "exit=$?"` — never through `| tail`/`| grep`.
- Commit: one task = one commit, explicit `git add <paths>` only (never `-A`).
- Themes wood / minimal / malachite all keep working; use CSS variables (`--bg --bg2 --text --muted --accent --panel --panel-b --ok --danger`).
- `noUnusedLocals` is on (`tsconfig.base.json`): remove imports/state a task makes unused; `npm run typecheck` must exit 0.
- Do not write `JSX.Element` return types (not resolvable under @types/react 19); omit return types or use `React.JSX.Element`.

### e2e readers that this plan breaks — fixed in the task that breaks them

Line numbers are for the **merged base** (re-run `grep -n` before editing; do not trust them blindly).

| Selector in `e2e/online.e2e.cjs` | Breaks in | Replacement |
|---|---|---|
| `.seg button:has-text("Короткие")` (~:411, on `/create`) | Task 3 | `.variant-card:has-text("Короткие")` |
| `waitForSelector('.room-card')` (~:420) | Task 4 | `.room-card2` |
| `button:has-text("✓")` (~:114,:117,:121) | Task 6 | wait/recovery: `button:has-text("Готово"):enabled`; click: `button:has-text("Готово")` (always-rendered disabled Done must not satisfy recovery) |
| `{name:'↶ Отменить',exact:true}`, `{name:'✓ Готово',…}` (~:202,:350) | Task 6 | `{name:'Отменить',exact:true}`, `{name:'Готово',exact:true}` |
| `.pbar .tag.warn` `waitFor hidden` (~:147) | Task 6 | `.strip .tag.warn`, **preceded** by `await p.locator('.strip').first().waitFor()` so zero matches cannot pass vacuously. The legacy `!hud` path (768 portrait) still renders `.pbar`; use `.pbar .tag.warn, .strip .tag.warn` if that path is exercised |
| `.status:has-text(...)`, `.status` reads (~:63,73,105,106,167,193,250,277,341,436) | none | **kept**: Task 6 renders a visually-hidden `<span className="status" role="status">` with `statusText` (1px clip, not `display:none`, so Playwright still sees it) |
| emoji bar clicks `.emoji-bar button` / `nth(5)` (~:453) | Task 6 | `button[aria-label="Реакции"]` then `[role="menuitem"]` `nth(5)` — `ActionBar` therefore receives `EMOJIS` (≥ 6), not the 4 quick ones |
| `.mobile-hud` geometry in PREVIEW_ONLY (~:353: board top `66.1875`, bottomGap `12`) | Task 6 | re-baseline in Task 7 with **measured** values; R2 scratch: top≈138.58, bottomGap=12, not final acceptance |
| `.game-top .score` (~:146, rejoin at 1100×900) | Task 6 | wait for `.board-svg` (header score absent on wide) |
| direct `button:has-text("Сдаться")` (~:463) | Task 6 | open `button[aria-label="Ещё"]` first; then click the exact resign button; retain confirmation |
| `.controls` diagnostic reads (~:53,:124) | Task 6 | `.action-bar, .controls` `.first().innerText()` (HUD / legacy respectively) |
| `.pmeta[data-pips]` text (~:44,69,196,202,208,346,350,371,431,458–459) | Task 6 | keep numeric pips/off text unchanged; render diff in sibling `.pdiff`; never append status/diff to `.pmeta` |

## Findings that changed the spec (checked in code)

1. **No "close room" in the Worker** (`worker/src/room.ts` closes sockets only at `:146 :206 :212 :419`; `ClientMsg` has no close/leave). Waiting-room button = **«Выйти»**. It leaves the client view; it does not close the server room.
2. `room.settings.isPublic` exists (`packages/core/src/protocol.ts:17`) → «Видна в лобби» is honest.
3. `CreateRoom` shares `VariantPicker`, so it gets variant cards too (Task 3 Step 5).
4. `Game.tsx` imports `SettingsScreen` and `Room.tsx` imports `PageHead` from `Menus.tsx` → no parallel batches.
5. The two polish branches merge **cleanly** (`git merge-tree` exit 0; reviewers ran it). 
6. CSS cascade: today `main.tsx` imports `./App` before `./styles.css`, so `styles.css` wins ties (measured on a built bundle). Fixed in Task 1.
7. Phone/desktop only: `Game.tsx` `compact` = portrait ≤767px, `wide` = ≥900×521, `hud = compact || wide`. **768×1024 portrait is neither** and keeps the legacy `!hud` layout (`.pbar`, ⚑ resign, 💬). Decision: the legacy path is **left untouched**; 768 is checked only for "no regression" by the existing LAYOUT_ONLY mode. The spec's «768» applies to menu screens.

### Planning clarifications (spec synchronized in this handover; final visual approval remains pending)

- Home rows have **no subtitles** (the only candidates — remembered params, room counter — are out of scope).
- Phone whitespace: own strip stays within 16px below the board; action bar stays at the bottom. Remaining vertical slack sits **between the own strip and the action bar**.
- Pips: only the **leader** shows «впереди на N»; the other strip shows nothing (a mirror «позади на N» is redundant).
- Phone header keeps the small match score; the large score is **desktop only**.
- Start button label: «Начать · Длинные · Матч до 3».
- «Готово» is **always visible** on compact/wide (disabled when nothing to confirm or when `autoConfirm` is on), as the spec says.
- Resume card is outlined (not gold) so the online row stays the **only gold** element.
- Lost on purpose: room code in lobby cards (the card itself joins); waiting-room elapsed timer (YAGNI).
- Kept (spec said nothing, must not regress): Crawford marker in the match meta line, `title` hints on timers, unread chat dot.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/App.tsx` | modify | remove bot-name emoji; keep localized level name |
| `apps/web/src/main.tsx` | modify | import `./styles.css` before `./App` |
| `apps/web/src/components/icons.tsx` | create | inline SVG `Icon` |
| `apps/web/src/screens/menus.css` | create | styles for redrawn menu screens |
| `apps/web/src/screens/Menus.tsx` | modify | `Home`, `GameSetup`, `VariantPicker`, `Online`, new `NameChip` |
| `apps/web/src/screens/Room.tsx` | modify | waiting-room block only |
| `apps/web/src/screens/GameHud.tsx` | create | `PlayerStrip`, `ActionBar` |
| `apps/web/src/screens/game-hud.css` | create | HUD + desktop area re-assignment |
| `apps/web/src/screens/Game.tsx` | modify | compose HUD; no logic changes |
| `apps/web/src/lib/i18n.ts` | modify | new keys, both languages |
| `e2e/screens.e2e.cjs` | create | gate G1 (menus) |
| `e2e/hud.e2e.cjs` | create | gate G2 (game HUD) |
| `e2e/online.e2e.cjs` | modify | selector fixes listed above |
| `GATES.md` | create | gate registry + red/green evidence |
| `docs/design/impl-screens/redesign-*.png` | create | final screenshots |
| spec + audit file under `docs/superpowers/` | modify | Task 5 amendments |

## Batch map (sequential; one writer per file at a time; model per task)

| Task | Owns (writes) | Also reads | Model |
|---|---|---|---|
| 0 base merge | git history | — | Opus (orchestrator) |
| 1 gate G1 + i18n + main.tsx | `e2e/screens.e2e.cjs`, `GATES.md`, `lib/i18n.ts`, `main.tsx` | — | Sonnet |
| 2 icons + Home | `icons.tsx`, `menus.css`, `Menus.tsx` (Home, NameChip) | i18n | Sonnet |
| 3 setup | `Menus.tsx` (GameSetup, VariantPicker), `menus.css`, `e2e/online.e2e.cjs` (:411) | icons | Sonnet |
| 4 lobby | `Menus.tsx` (Online, Seg, SettingsScreen speed class), `menus.css`, `e2e/online.e2e.cjs` (:420) | icons | Sonnet |
| 5 waiting room | `App.tsx` (bot-name emoji), `Room.tsx` (waiting + password/not-found icons), `menus.css`, spec, audit file, `GATES.md` | `Menus.tsx` (PageHead) | Sonnet (advisor Opus) |
| 6 game HUD | `e2e/hud.e2e.cjs`, `GameHud.tsx`, `game-hud.css`, `Game.tsx`, `e2e/online.e2e.cjs` (HUD selectors), `GATES.md` | `Menus.tsx` (SettingsScreen), store | Sonnet (advisor Opus) |
| 7 final verify | `e2e/online.e2e.cjs` (PREVIEW constants), screenshots, `GATES.md` | all | Opus (orchestrator) |

After every task: orchestrator reads the diff, then `npm run typecheck; echo tc=$?`, `npm test; echo test=$?`, `npm run build; echo build=$?`, and **the default `online.e2e.cjs` must exit 0** (the selector fixes travel with the task that breaks them, so e2e stays green after each task).

---

### Task 0: Base — merge the two polish branches

- [ ] **Step 1: Branch**

```bash
cd /Users/oleksandrkhaliavinskyi/Projects/Backgammon
git status --short            # must be clean
git switch -c feat/screens-redesign docs/screens-redesign-spec
```
- [ ] **Step 2: Merge** (clean, verified by dry-run)

```bash
git merge --no-ff claude/screens-polish-24f596 -m "Merge screens-polish: unified page header, cards, toggles"
git merge --no-ff claude/desktop-layout-4055b7 -m "Merge desktop-layout: board left, side column right"
```
If a conflict appears anyway, both sides only append blocks to `styles.css`: keep both.
- [ ] **Step 3: Green base**

```bash
npm ci; npm run typecheck; echo tc=$?; npm test; echo test=$?; npm run build; echo build=$?
```
Expected `=0` ×3 (core: 25 tests).
- [ ] **Step 4: Live baseline**

```bash
export NODE_PATH=$HOME/.npm/_npx/9833c18b2d85bc59/node_modules NARDY_URL=http://127.0.0.1:8787
npm run dev:worker > /tmp/wr.log 2>&1 &   sleep 6
node e2e/online.e2e.cjs /tmp/nardy-e2e > /tmp/e2e-base.txt; echo "exit=$?"
```
Expected `exit=0`. If not, stop; do not start the redesign on a red base. Keep the worker running for later tasks (one wrangler at a time: SQLITE_BUSY).
- [ ] **Step 5:** note the merged SHA in the handoff. No commit needed.

---

### Task 1: Gate G1 + i18n keys + cascade fix

**Files:** Create `e2e/screens.e2e.cjs`, `GATES.md`. Modify `apps/web/src/lib/i18n.ts`, `apps/web/src/main.tsx`.

**Produces:** i18n keys (below); `node e2e/screens.e2e.cjs` prints one line per finding and ends with `offenders=N`.

- [ ] **Step 1: Write the gate.** Presence checks use `found N, expected M` messages so deleting a feature cannot satisfy them.

```js
// e2e/screens.e2e.cjs  — NODE_PATH/NARDY_URL as in plan; exit code is the script's own.
const { chromium } = require('playwright');
const BASE = process.env.NARDY_URL || 'http://127.0.0.1:8787';
const WIDTHS = [360, 768, 1440];
const LOCALES = ['ru-RU', 'en-US'];
const EMOJI = /\p{Extended_Pictographic}/u;
const BAD = [];
const room = (i) => ({ id: 'AAA00' + i, host: ['Marta', 'Алексей', 'Ника', 'Борис', 'Ира', 'Лев'][i], hasPassword: i % 2 === 0, createdAt: Date.now(),
  settings: { variant: i % 2 ? 'long' : 'short', matchLength: 3, moveTimer: 30, bank: 600, cube: i % 2 === 0, isPublic: true } });

async function audit(p, label, expectCounts) {
  const out = await p.evaluate(({ src }) => {
    const re = new RegExp(src, 'u'), o = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw) o.push(`overflow-x: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll('button, a, h1, h2, h3, summary, label')) {
      const t = (el.textContent || '').trim();
      if (re.test(t)) o.push(`emoji in <${el.tagName.toLowerCase()}>: "${t.slice(0, 30)}"`);
    }
    for (const el of document.querySelectorAll('button, a[href], summary, input[type=checkbox], input[role=switch]')) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (b.height < 44 && b.width < 44) o.push(`tap target ${Math.round(b.width)}x${Math.round(b.height)}: "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`);
      else if (b.height < 44 && el.tagName !== 'INPUT') o.push(`tap height ${Math.round(b.height)}: "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`);
    }
    return o;
  }, { src: EMOJI.source });
  for (const f of out) BAD.push(`${label}: ${f}`);
  for (const [sel, n] of Object.entries(expectCounts || {})) {
    const got = await p.locator(sel).count();
    if (got !== n) BAD.push(`${label}: found ${got} "${sel}", expected ${n}`);
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const locale of LOCALES) for (const w of WIDTHS) {
  // Each context needs its own room; sharing one starts a match on context #2.
  const created = await (await fetch(BASE + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { variant: 'long', matchLength: 3, moveTimer: 30, bank: 600, cube: false, isPublic: false }, password: '', name: 'Gate' }) })).json();
    if (!created.id) throw new Error('room creation failed: ' + JSON.stringify(created));
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, locale });
    const p = await ctx.newPage();
    await p.route('**/api/rooms', (r) => r.request().method() === 'GET' ? r.fulfill({ json: { rooms: [0, 1, 2, 3, 4, 5].map(room) } }) : r.continue());
    const L = (r) => `${w} ${locale} ${r}`;
    await p.goto(BASE + '/');            await p.waitForLoadState('networkidle');
    await audit(p, L('/'), { '.menu-row': 3, '.menu-row.primary': 1, '.home2-head .icon-btn': 1 });
    for (const r of ['/ai', '/local']) { await p.goto(BASE + r); await p.waitForLoadState('networkidle');
      await audit(p, L(r), { '.variant-card': 2, '.name-chip': 1, '.bottom-bar .btn.primary': 1, '.switch-row': 1 }); }
    await p.goto(BASE + '/online');       await p.waitForLoadState('networkidle');
    await audit(p, L('/online'), { '.room-card2': 6, '.lobby-filter [role=radio]': 3, '.lobby-bar form': 1, '.name-chip': 1 });
    await p.goto(BASE + '/create');       await p.waitForLoadState('networkidle');
    await audit(p, L('/create'), { '.variant-card': 2 });
    await p.goto(BASE + '/settings');     await p.waitForLoadState('networkidle');
    await audit(p, L('/settings'), {});
    await p.goto(BASE + '/r/' + created.id); await p.waitForSelector('.wait2', { timeout: 8000 }).catch(() => {});
    await audit(p, L('/r/:id'), { '.code-card': 1, '.params > div': 4, '.wait2 .btn.primary': 1 });
    await ctx.close();
  }
  await browser.close();
  console.log(BAD.length ? BAD.join('\n') : 'screens gate: 0 offenders');
  console.log(`offenders=${BAD.length}`);
  process.exit(BAD.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
```

- [ ] **Step 2: Run on the base — it MUST fail naming emoji, small targets and missing features**

```bash
node e2e/screens.e2e.cjs > /tmp/g1-base.txt; echo "exit=$?"; head -8 /tmp/g1-base.txt; tail -1 /tmp/g1-base.txt
```
Expected: `exit=1`; lines like `360 ru-RU /: emoji in <button>: "🌐 Играть онлайн"` and `found 0 ".menu-row", expected 3`; last line `offenders=N` with N > 0. A crash is `exit=2` and is **not** a red result — fix the environment. Paste the head into `GATES.md` EVIDENCE.

- [ ] **Step 3: `GATES.md`**

```markdown
# Gates — screens redesign
## G1 menu screens
OWNS: Menus.tsx, Room.tsx, menus.css, icons.tsx, main.tsx
CHECK: node e2e/screens.e2e.cjs > /tmp/g1.txt; echo "exit=$?"
EXPECT: exit=0 and last line "offenders=0" (presence counts + no emoji/overflow/tap<44, ru+en, 360/768/1440)
EVIDENCE: base RED: <paste>; green after Task 5: <paste>
## G2 game HUD
OWNS: GameHud.tsx, game-hud.css, Game.tsx
CHECK: node e2e/hud.e2e.cjs > /tmp/g2.txt; echo "exit=$?"; plus default + all *_ONLY modes of online.e2e.cjs
EXPECT: exit=0 each
EVIDENCE: base RED: <paste>; green after Task 7: <paste>
```

- [ ] **Step 4: i18n keys** — add to **both** `ru` and `en` in `apps/web/src/lib/i18n.ts` (a missing `en` key fails typecheck; `moreActions` already exists as `more`, reuse `T.more`, do not add):

| key | ru | en |
|---|---|---|
| `playingAs` | `Играете как` | `Playing as` |
| `botLevelHint` | `Новичок — учится; Любитель — для тех, кто знает правила; Мастер — играет сильно.` | `Beginner is learning; Amateur suits players who know the rules; Master plays hard.` |
| `startWith` | `Начать` | `Start` |
| `cubeOnlyShort` | `только в коротких` | `short only` |
| `howToPlay` | `Как играть: длинные и короткие` | `How to play: long and short` |
| `newGame` | `Новая игра` | `New game` |
| `filterAll` / `filterLong` / `filterShort` | `Все` / `Длинные` / `Короткие` | `All` / `Long` / `Short` |
| `haveCode` | `Есть код?` | `Have a code?` |
| `byPassword` | `по паролю` | `password` |
| `enter` | `Войти` | `Enter` |
| `roomCode` | `Код комнаты` | `Room code` |
| `copyLink` | `Скопировать ссылку` | `Copy link` |
| `shareLink2` | `Поделиться ссылкой` | `Share link` |
| `leaveRoom` | `Выйти` | `Leave` |
| `visibleInLobby` | `Видна в лобби` | `Listed in lobby` |
| `hiddenFromLobby` | `Только по ссылке` | `Link only` |
| `access` | `Доступ` | `Access` |
| `accessOpen` | `Открытая` | `Open` |
| `accessPassword` | `С паролем` | `Password` |
| `reactions` | `Реакции` | `Reactions` |
| `pipsAhead` | `впереди на` | `ahead by` |
| `pipsEven` | `равны` | `even` |

- [ ] **Step 5: cascade fix** in `apps/web/src/main.tsx` — move the stylesheet import above `./App`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
```
Verify: `npm run build; echo build=$?` then in `apps/web/dist/assets/*.css` the offset of the string `.screen{` (or `.screen {`) must be **smaller** than the offset of any rule from `menus.css` once Task 2 exists. For now: `grep -bo "\.btn{\|\.btn {" apps/web/dist/assets/*.css | head -1` is near offset 0..few KB (styles.css first).

- [ ] **Step 6: Commit**

```bash
npm run typecheck; echo tc=$?
git add e2e/screens.e2e.cjs GATES.md apps/web/src/lib/i18n.ts apps/web/src/main.tsx
git commit -m "test: menu screens gate G1; i18n keys; load styles.css before screens"
```

---

### Task 2: Icons + Home

**Files:** Create `apps/web/src/components/icons.tsx`, `apps/web/src/screens/menus.css`. Modify `apps/web/src/screens/Menus.tsx` (`Home`, add `NameChip`, import css and icons).

**Produces:** `Icon({ name, size })` with `IconName = 'globe'|'robot'|'people'|'gear'|'chevron'|'back'|'dots'|'share'|'copy'|'refresh'|'lock'|'smile'|'undo'|'check'|'book'|'edit'|'chat'|'plus'`; `NameChip()`.

- [ ] **Step 1: `icons.tsx`**

```tsx
export type IconName = 'globe' | 'robot' | 'people' | 'gear' | 'chevron' | 'back' | 'dots' | 'share' | 'copy' | 'refresh' | 'lock' | 'smile' | 'undo' | 'check' | 'book' | 'edit' | 'chat' | 'plus';
const P: Record<IconName, string> = {
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18',
  robot: 'M5 8h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM12 8V4M9 13h.01M15 13h.01',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c.6-3 3-5 6-5s5.4 2 6 5M17 10a2.5 2.5 0 1 0 0-5M16.5 14c2.3.2 4 1.7 4.5 4.5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  copy: 'M8 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  lock: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3',
  smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2M9 10h.01M15 10h.01',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  chat: 'M4 5h16v11H9l-5 4z',
  plus: 'M12 5v14M5 12h14',
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={P[name]} />
    </svg>
  );
}
```

- [ ] **Step 2: `NameChip` and `Home`** in `Menus.tsx`. Add at the top `import './menus.css'; import { Icon } from '../components/icons';`.

```tsx
export function NameChip() {
  const T = useT();
  const { name, set } = useSettings();
  const [edit, setEdit] = useState(false);
  if (edit)
    return <input className="name-input" autoFocus value={name} maxLength={20} placeholder={T.you} aria-label={T.yourName}
      onChange={(e) => set({ name: e.target.value })} onBlur={() => setEdit(false)} onKeyDown={(e) => e.key === 'Enter' && setEdit(false)} />;
  return (
    <button className="name-chip" onClick={() => setEdit(true)}>
      <span className="muted">{T.playingAs}</span> <b>{name || T.you}</b> <Icon name="edit" size={14} />
    </button>
  );
}
```

`Home` (logic — `saved`, `unlockAudio`, `nav` targets — unchanged; markup only):

```tsx
<div className="screen home2">
  <header className="home2-head">
    <span className="home2-brand"><Logo size={36} /><b>{T.appName}</b></span>
    <button className="icon-btn t44" aria-label={T.settings} onClick={() => nav('/settings')}><Icon name="gear" /></button>
  </header>
  {saved && (
    <button className="resume-card" onClick={() => nav('/play?resume=1')}>
      <span className="resume-play" aria-hidden><Icon name="chevron" /></span>
      <span className="grow"><b>{T.continueGame}</b></span>
    </button>
  )}
  <div className="eyebrow">{T.newGame}</div>
  <button className="menu-row primary" onClick={() => (unlockAudio(), nav('/online'))}><Icon name="globe" size={26} /><span className="grow"><b>{T.playOnline}</b></span><Icon name="chevron" /></button>
  <button className="menu-row" onClick={() => (unlockAudio(), nav('/ai'))}><Icon name="robot" size={26} /><span className="grow"><b>{T.playAi}</b></span><Icon name="chevron" /></button>
  <button className="menu-row" onClick={() => (unlockAudio(), nav('/local'))}><Icon name="people" size={26} /><span className="grow"><b>{T.playLocal}</b></span><Icon name="chevron" /></button>
  <details className="rules home2-rules">
    <summary><Icon name="book" /> {T.howToPlay}</summary>
    <h3>{T.long}</h3><p>{T.rulesLong}</p><h3>{T.short}</h3><p>{T.rulesShort}</p>
  </details>
</div>
```
`Logo` already takes `size`; the old `<h1>` and `.tagline` are dropped (the brand text is `<b>`; keep `document.title` as is).

- [ ] **Step 3: `menus.css`** (new classes; compound selectors where an existing rule must be raised):

```css
html { background: var(--bg); }
.screen.home2 { max-width: 560px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 20px; justify-content: flex-start; }
.home2-head { display: flex; align-items: center; justify-content: space-between; min-height: 48px; }
.home2-brand { display: flex; align-items: center; gap: 10px; font-size: 22px; }
.icon-btn.t44 { width: 44px; height: 44px; }
.page-head .back { min-height: 44px; }
.eyebrow { font-size: 13px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); padding: 6px 4px 0; }
.menu-row { display: flex; align-items: center; gap: 14px; min-height: 76px; padding: 14px 16px; border-radius: 18px; background: var(--panel); border: 1px solid var(--panel-b); color: var(--text); font-size: 17px; text-align: left; cursor: pointer; }
.menu-row.primary { background: var(--accent); border-color: var(--accent); color: #1a0d06; }
.menu-row .grow, .resume-card .grow { flex: 1; }
.resume-card { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: 18px; background: var(--bg2); border: 1px solid var(--panel-b); color: var(--text); cursor: pointer; min-height: 64px; }
.resume-play { width: 44px; height: 44px; border-radius: 50%; background: var(--accent); color: #1a0d06; display: grid; place-items: center; }
.home2-rules { margin-top: auto; }
.home2-rules summary { min-height: 44px; display: flex; align-items: center; gap: 10px; }
.name-chip { align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border-radius: 22px; border: 1px solid var(--panel-b); background: var(--panel); font-size: 14px; cursor: pointer; }
.name-input { align-self: flex-start; min-height: 44px; padding: 0 14px; border-radius: 22px; border: 1px solid var(--accent); background: var(--panel); color: var(--text); font-size: 16px; }
@media (min-width: 900px) { .screen.home2 { padding-top: 48px; } }
```
`.page-head .back { min-height: 44px }` changes the shared `PageHead` for **all** its readers: Menus (`GameSetup`, `Online`, `CreateRoom`, `SettingsScreen`), `Room.tsx` (password / rejoin screens), and the in-game settings dialog (`Game.tsx` → `SettingsScreen`). Check `/settings` and the in-game settings dialog at 360 in Step 4.

- [ ] **Step 4: Verify**

```bash
npm run typecheck; echo tc=$?; npm run build; echo build=$?
# cascade proof: computed padding of .screen.home2 must be the menus.css value (12px 16px 20px), not styles.css's
node e2e/screens.e2e.cjs > /tmp/g1.txt; echo "exit=$?"; grep -c " ru-RU /:" /tmp/g1.txt; grep " /:" /tmp/g1.txt | head
```
Expected: no `/:` lines (home is clean in both locales at 3 widths); other routes still red (correct at this point). Also open `/` at 360 and `/settings` at 360 in the browser: home has no overflow, console clean, the in-game settings dialog title row not clipped. Standalone RU settings speed overflow is an expected pending Task 4 fix, not a reason to claim G1 green here. Then `node e2e/online.e2e.cjs > /tmp/e2e.txt; echo "exit=$?"` → 0.

- [ ] **Step 5: Commit** `git add apps/web/src/components/icons.tsx apps/web/src/screens/menus.css apps/web/src/screens/Menus.tsx && git commit -m "feat(web): home screen — svg icons, resume card, compact header"`

---

### Task 3: Setup screen (bot / local) and shared VariantPicker

**Files:** Modify `Menus.tsx` (`VariantPicker`, `GameSetup`), `menus.css`, `e2e/online.e2e.cjs` (the `/create` selector).

- [ ] **Step 1: `VariantPicker`** (used by `GameSetup` and `CreateRoom`):

```tsx
function VariantPicker({ value, onChange }: { value: Variant; onChange: (v: Variant) => void }) {
  const T = useT();
  const opts: { v: Variant; label: string; sub: string }[] = [{ v: 'long', label: T.long, sub: T.longDesc }, { v: 'short', label: T.short, sub: T.shortDesc }];
  return (
    <div className="variant-cards" role="radiogroup" aria-label={T.variant}>
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={o.v === value} className={'variant-card' + (o.v === value ? ' on' : '')} onClick={() => onChange(o.v)}>
          <b>{o.label}</b><span>{o.sub}</span>
        </button>
      ))}
    </div>
  );
}
```
Note `CreateRoom` wraps it in `<label className="field"><span>…` — change that wrapper to a plain `<div className="field">` so a `<label>` does not swallow the radio buttons.

- [ ] **Step 2: `GameSetup` markup** (state and URL logic unchanged except `cube` for long):

```tsx
<div className="screen form setup2">
  <PageHead title={mode === 'ai' ? T.playAi : T.playLocal} onBack={() => nav('/')} />
  <NameChip />
  <div className="eyebrow">{T.variant}</div>
  <VariantPicker value={variant} onChange={setVariant} />
  <label className={'check switch-row' + (variant === 'short' ? '' : ' off')}>
    <span className="grow">{T.cube}{variant !== 'short' && <small> · {T.cubeOnlyShort}</small>}</span>
    <input type="checkbox" role="switch" checked={variant === 'short' && cube} disabled={variant !== 'short'} onChange={(e) => setCube(e.target.checked)} />
  </label>
  {mode === 'ai' && (<>
    <div className="eyebrow">{T.aiLevel}</div>
    <Seg value={level} onChange={setLevel} options={[{ v: 'beginner', label: T.beginner }, { v: 'amateur', label: T.amateur }, { v: 'master', label: T.master }]} />
    <p className="muted hint">{T.botLevelHint}</p>
  </>)}
  <div className="eyebrow">{T.matchLength}</div>
  <Seg value={len} onChange={setLen} options={MATCH_LENGTHS.map((v) => ({ v, label: String(v) }))} />
  <div className="bottom-bar">
    <button className="btn primary big" onClick={() => nav(`/play?mode=${mode}&variant=${variant}&len=${len}&cube=${variant === 'short' && cube ? 1 : 0}&level=${level}`)}>
      {T.startWith} · {variant === 'long' ? T.long : T.short} · {T.matchLength} {len}
    </button>
  </div>
</div>
```
`.check` is the existing class that sizes the checkbox/switch input (scoped `.check input`), so the switch is not a 13px native box.

- [ ] **Step 3: CSS**

```css
.variant-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.variant-card { text-align: left; padding: 14px; min-height: 96px; border-radius: 16px; background: var(--panel); border: 2px solid var(--panel-b); color: var(--text); display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
.variant-card.on { border-color: var(--accent); background: var(--bg2); }
.variant-card b { font-size: 17px; }
.variant-card span { font-size: 14px; line-height: 1.35; color: var(--muted); }
.check.switch-row { min-height: 44px; padding: 0 4px; }
.check.switch-row .grow { flex: 1; }
.check.switch-row.off { opacity: .55; }
.check.switch-row small { color: var(--muted); }
.hint { margin: -4px 4px 0; font-size: 14px; }
.screen.setup2, .screen.online2 { padding-bottom: 112px; }
.bottom-bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px max(16px, env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--panel-b); display: flex; justify-content: center; z-index: 5; }
.bottom-bar .btn { width: 100%; max-width: 528px; }
```

- [ ] **Step 4: e2e** — in `e2e/online.e2e.cjs` replace `.seg button:has-text("Короткие")` with `.variant-card:has-text("Короткие")` (`grep -n 'seg button' e2e/online.e2e.cjs` first; change every `/create` hit).

- [ ] **Step 5: Verify**

```bash
npm run typecheck; echo tc=$?; npm run build; echo build=$?
node e2e/screens.e2e.cjs > /tmp/g1.txt; echo "exit=$?"; grep " /ai\| /local\| /create" /tmp/g1.txt | head
node e2e/online.e2e.cjs > /tmp/e2e.txt; echo "exit=$?"
```
Expected: no `/ai`, `/local`, `/create` lines; e2e `exit=0`. In the browser at **360×640** on `/ai`, scroll to the bottom: the last `.seg` bottom edge is above the top edge of `.bottom-bar` (measure both rects; names the pixels). Pick Short + 3 + Start: URL contains `variant=short&len=3&cube=1`; Long: `cube=0`.

- [ ] **Step 6: Commit** `git add apps/web/src/screens/Menus.tsx apps/web/src/screens/menus.css e2e/online.e2e.cjs && git commit -m "feat(web): setup screen — name chip, variant cards, cube switch, bottom start bar"`

---

### Task 4: Online lobby

**Files:** Modify `Menus.tsx` (`Online`, `Seg`, `SettingsScreen` speed class), `menus.css`, `e2e/online.e2e.cjs` (`.room-card` → `.room-card2`).

- [ ] **Step 1: State, filter, chips** inside `Online`:

```tsx
const [filter, setFilter] = useState<'all' | Variant>('all');
const shown = rooms?.filter((r) => filter === 'all' || r.settings.variant === filter);
const chips = (s: RoomSettings) => [
  s.variant === 'long' ? T.long : T.short,
  `${T.matchLength} ${s.matchLength}`,
  s.moveTimer || s.bank ? [s.moveTimer && `${s.moveTimer} ${T.sec}`, s.bank && `${s.bank / 60} ${T.min}`].filter(Boolean).join(' + ') : '∞',
  ...(s.cube ? [T.cube] : []),
];
```
Delete the old `timerLabel`.

- [ ] **Step 2: Markup** (full, replaces the `Online` return):

```tsx
<div className="screen form online2">
  <PageHead title={T.playOnline} onBack={() => nav('/')} />
  <NameChip />
  <button className="btn primary big" onClick={() => nav('/create')}><Icon name="plus" /> {T.createRoom}</button>
  <div className="lobby-tools">
    <Seg className="lobby-filter" value={filter} onChange={setFilter}
      options={[{ v: 'all', label: T.filterAll }, { v: 'long', label: T.filterLong }, { v: 'short', label: T.filterShort }]} />
    <button className="icon-btn t44" aria-label={T.refresh} onClick={load}><Icon name="refresh" /></button>
  </div>
  <div className="eyebrow">{T.lobby} · {shown?.length ?? 0}</div>
  {rooms === null && <p className="muted">…</p>}
  {shown?.length === 0 && <p className="muted empty-text">{T.noRooms}</p>}
  {shown?.map((r) => (
    <button key={r.id} className="room-card2" onClick={() => nav('/r/' + r.id)}>
      <span className="avatar" aria-hidden>{r.host.charAt(0).toUpperCase()}</span>
      <span className="room-main">
        <span className="room-host"><b>{r.host}</b>{r.hasPassword && <span className="lock-chip"><Icon name="lock" size={12} /> {T.byPassword}</span>}</span>
        <span className="chips">{chips(r.settings).map((c) => <span key={c} className="chip">{c}</span>)}</span>
      </span>
      <span className="room-enter">{T.enter}</span>
    </button>
  ))}
  <div className="lobby-bar">
    <form onSubmit={(e) => { e.preventDefault(); const c = code.trim().toUpperCase(); if (/^[A-Z0-9]{6}$/.test(c)) nav('/r/' + c); }}>
      <label htmlFor="room-code" className="muted">{T.haveCode}</label>
      <input id="room-code" className="grow code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" />
      <button className="btn">{T.enter}</button>
    </form>
  </div>
</div>
```
`Seg` must accept an optional `className` (add `className?: string` to its props and append it to `"seg"`). In **SettingsScreen only**, pass `className="seg-2col"` to the animation-speed Seg. Do not select all four-option Segs: match length also has four options and must stay one row. Typecheck proves the prop; G1 proves the standalone RU settings screen no longer overflows at 360. Recheck the in-game dialog too.

- [ ] **Step 3: CSS**

```css
.lobby-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.seg.lobby-filter { flex: 1; }
.seg.seg-2col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.room-card2 { display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; min-height: 68px; border-radius: 16px; background: var(--panel); border: 1px solid var(--panel-b); color: var(--text); text-align: left; cursor: pointer; }
.avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--bg2); display: grid; place-items: center; font-weight: 800; flex: none; }
.room-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.room-host { display: flex; align-items: center; gap: 8px; }
.lock-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 8px; background: color-mix(in srgb, var(--text) 8%, transparent); }
.room-enter { color: var(--accent); font-weight: 700; padding: 0 6px; }
.empty-text { padding: 24px 4px; }
.lobby-bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px max(16px, env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--panel-b); display: flex; justify-content: center; z-index: 5; }
.lobby-bar form { display: flex; gap: 8px; align-items: center; width: 100%; max-width: 528px; }
.lobby-bar .code-input { min-width: 0; min-height: 44px; }
```
(`html { background: var(--bg) }` from Task 2 removes the fixed-gradient seam; confirm in Step 5.)

- [ ] **Step 4: e2e** — `waitForSelector('.room-card')` → `.room-card2` (`grep -n "room-card" e2e/online.e2e.cjs`; change all).

- [ ] **Step 5: Verify**: typecheck/build `=0`; `node e2e/screens.e2e.cjs > /tmp/g1.txt; echo "exit=$?"` → no `/online` lines (6 mocked cards, 3 filter radios, bottom form); default `online.e2e.cjs` `exit=0`. Browser at 360 with the mock from the gate (`page.route('**/api/rooms')` returning 6 rooms): scroll the page to the very bottom — the last card's bottom is above `.lobby-bar` top; filter `Длинные` leaves only long rooms; no colour step between the top and bottom of the page (screenshot both ends).

- [ ] **Step 6: Commit** `git add apps/web/src/screens/Menus.tsx apps/web/src/screens/menus.css e2e/online.e2e.cjs && git commit -m "feat(web): online lobby — filter, parameter chips, bottom code bar"`

---

### Task 5: Waiting room

**Files:** Modify `Room.tsx` (waiting return plus password/not-found icons), `App.tsx` (bot-name emoji only), `menus.css`, the spec, the audit file, `GATES.md`.

- [ ] **Step 1: Replace the waiting block** (add `import { Icon } from '../components/icons';`; guard `room === null`):

```tsx
if (!match) {
  const s = room?.settings;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ url: link, title: T.appName });
      else await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch { /* cancelled */ }
  };
  return (
    <div className="screen form wait2">
      <PageHead title={T.waitingOpponent} onBack={() => nav('/online')} />
      <div className="code-card">
        <span className="muted">{T.roomCode}</span>
        <p className="code big-code" aria-label={id}>{[...id].map((ch, i) => <span key={i}>{ch}</span>)}</p>
        {s && <span className={'status-pill' + (s.isPublic ? ' ok' : '')}>{s.isPublic ? T.visibleInLobby : T.hiddenFromLobby}</span>}
      </div>
      <button className="btn primary big" onClick={share}><Icon name="share" /> {T.shareLink2}</button>
      <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* ignore */ } }}>
        <Icon name="copy" /> {copied ? T.copied : T.copyLink}
      </button>
      {s && (
        <dl className="params">
          <div><dt>{T.variant}</dt><dd>{s.variant === 'long' ? T.long : T.short}</dd></div>
          <div><dt>{T.matchLength}</dt><dd>{s.matchLength}</dd></div>
          <div><dt>{T.moveTimer}</dt><dd>{s.moveTimer ? `${s.moveTimer} ${T.sec}` : T.off}{s.bank ? ` + ${s.bank / 60} ${T.min}` : ''}</dd></div>
          <div><dt>{T.access}</dt><dd>{room?.hasPassword ? T.accessPassword : T.accessOpen}</dd></div>
        </dl>
      )}
      <button className="link leave" onClick={() => nav('/online')}>{T.leaveRoom}</button>
    </div>
  );
}
```
The old `.share` / `<code>{link}</code>` row is dropped (raw URL no longer shown); the `copied` state is reused.

Also replace the password PageHead's 🔒 with `<Icon name="lock" />` plus localized text (extend PageHead title to ReactNode if needed, updating its readers). Replace the not-found 🎲 with a neutral existing SVG icon. In `App.tsx`, bot name becomes `T[level]` without 🤖. Do not change controllers or protocol. Manually cover a password room and an invalid/nonexistent room at 360 in both languages; G1's normal waiting room does not cover these branches.

- [ ] **Step 2: CSS**

```css
.screen.wait2 { max-width: 560px; margin: 0 auto; width: 100%; gap: 12px; }
.code-card { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px 16px; border-radius: 20px; background: var(--bg2); border: 1px solid var(--panel-b); }
.status-pill { font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 14px; background: var(--panel); color: var(--muted); }
.status-pill.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.params { margin: 0; border-radius: 16px; border: 1px solid var(--panel-b); overflow: hidden; }
.params > div { display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--panel-b); }
.params > div:last-child { border-bottom: 0; }
.params dt { color: var(--muted); } .params dd { margin: 0; font-weight: 700; }
.leave { align-self: center; min-height: 44px; padding: 0 16px; }
```

- [ ] **Step 3: Verify doc consistency** — the spec and audit were synchronized during the final handover. Keep «Выйти» (leaves the client, does not close the room), the planning clarifications and the Worker reference consistent with the implementation. Do not repeat stale edits by line number or describe planning choices as final visual approval.

- [ ] **Step 4: Verify live** (wrangler running): create a room through the UI, check `/r/<id>` at 360/768/1440: code card, two buttons, params equal what was chosen, pill flips with the «Публичная» toggle both ways, «Скопировать» → «Скопировано». `node e2e/screens.e2e.cjs > /tmp/g1.txt; echo "exit=$?"` → **`exit=0`, `offenders=0`** (all routes incl. `/r/:id`, ru + en). Default `online.e2e.cjs` `exit=0`. Fill `GATES.md` G1 EVIDENCE (red base head + green tail).

- [ ] **Step 5: Commit** `git add apps/web/src/App.tsx apps/web/src/screens/Room.tsx apps/web/src/screens/menus.css docs/superpowers/specs/2026-11-15-screens-redesign-design.md docs/superpowers/plans/2026-11-15-screens-redesign-spec-audit.md GATES.md && git commit -m "feat(web): waiting room — code card, share-first, params, leave"`

---

### Task 6: Game HUD (phone and desktop)

**Files:** Create `e2e/hud.e2e.cjs`, `apps/web/src/screens/GameHud.tsx`, `apps/web/src/screens/game-hud.css`. Modify `apps/web/src/screens/Game.tsx`, `e2e/online.e2e.cjs` (HUD selectors from the table), `GATES.md`.

Scope: `compact` (portrait ≤767) and `wide` (≥900×521). The legacy `!hud` path (768 portrait) is **not changed**. The existing `.controls`, `.status`, undo/done, claim/resign, `desk-more` and `.emoji-bar` JSX is shared on the base: preserve it under an explicit `!hud` branch (`<div className="desktop-hud"><div className="controls">…</div></div>` plus legacy social menu). All deletion/replacement instructions below apply **only to hud**. At 768 portrait status, Undo/Done and reactions must still work.

- [ ] **Step 0: Measure the base, then write the gate and prove it red.** Measure first (thresholds come from this number):

```bash
node -e "
const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({channel:'chrome'});const p=await b.newPage({viewport:{width:360,height:780}});
await p.goto(process.env.NARDY_URL+'/play?mode=local&variant=long&len=1');await p.waitForSelector('.board-wrap');
console.log(await p.evaluate(()=>{const w=document.querySelector('.board-wrap').getBoundingClientRect(),h=document.querySelector('.mobile-hud').getBoundingClientRect();return {boardBottom:w.bottom,hudTop:h.top,gap:h.top-w.bottom}}));await b.close()})()"
```
Write the printed `gap` into `GATES.md` as the base value (reviewers saw ≈100px). Design target = the canvas flex gap (8px) + the strip's own margin: **threshold 16px**; the base value must be > 16, otherwise stop and re-read the canvas.

```js
// e2e/hud.e2e.cjs — local-mode game (no server state needed beyond static app). Exit code is the script's own.
const { chromium } = require('playwright');
const BASE = process.env.NARDY_URL || 'http://127.0.0.1:8787';
const BAD = [];
const num = (s) => parseInt((s.match(/\d+/) || ['-1'])[0], 10);
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  for (const [w, h, locale] of [[360, 780, 'ru-RU'], [360, 780, 'en-US'], [1440, 900, 'ru-RU']]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, locale })).newPage();
    const L = `${w} ${locale}`;
    await p.goto(BASE + '/play?mode=local&variant=long&len=1'); await p.waitForSelector('.board-wrap');
    const n = await p.locator('.strip').count();
    if (n !== 2) BAD.push(`${L}: found ${n} ".strip", expected 2`);
    else {
      const r = await p.evaluate(() => {
        const R = (s, i = 0) => document.querySelectorAll(s)[i]?.getBoundingClientRect();
        const board = R('.board-wrap'), a = R('.strip', 0), c = R('.strip', 1);
        const small = [...document.querySelectorAll('.action-bar button, .strip button, .game-top button')]
          .map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width && r.height && (r.height < 44 || r.width < 44))
          .map(([e, r]) => `${Math.round(r.width)}x${Math.round(r.height)} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20)}"`);
        return { board: { top: board.top, bottom: board.bottom }, a: { top: a.top, bottom: a.bottom }, c: { top: c.top, bottom: c.bottom },
          turnNow: document.querySelectorAll('.turn-now').length, status: document.querySelectorAll('.status').length,
          pm: [...document.querySelectorAll('.pmeta')].map((e) => e.textContent), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          small, undoDisabled: [...document.querySelectorAll('.action-bar button')].find((e) => /Отменить|Undo/.test(e.textContent))?.disabled };
      });
      if (w < 900) {
        if (!(r.a.bottom <= r.board.top + 1)) BAD.push(`${L}: opponent strip bottom ${Math.round(r.a.bottom)} not above board top ${Math.round(r.board.top)}`);
        const gap = Math.round(r.c.top - r.board.bottom);
        if (gap > 16) BAD.push(`${L}: gap board→own strip = ${gap}px (max 16)`);
      } else {
        const gap = Math.round(r.c.top - r.a.bottom);
        if (gap > 24) BAD.push(`${L}: gap opponent→own strip = ${gap}px (max 24)`);
        if ((await p.locator('.game.desk2').count()) !== 1) BAD.push(`${L}: found 0 ".game.desk2", expected 1`);
        if (!/\d+\s*:\s*\d+/.test((await p.locator('.desk-score').first().textContent().catch(() => '')) || '')) BAD.push(`${L}: ".desk-score" has no score`);
      }
      if (r.turnNow !== 1) BAD.push(`${L}: found ${r.turnNow} ".turn-now", expected 1`);
      if (r.status !== 1) BAD.push(`${L}: found ${r.status} ".status", expected 1`);
      if (r.overflow > 0) BAD.push(`${L}: horizontal overflow ${r.overflow}px`);
      for (const s of r.small) BAD.push(`${L}: tap target ${s}`);
      if (r.undoDisabled !== true) BAD.push(`${L}: Undo should be disabled before the first move, got ${r.undoDisabled}`);
      const [pa, pc] = r.pm.map(num), diff = Math.abs(pa - pc);
      const labels = await p.locator('.pdiff').allTextContents();
      const ahead = labels.filter((t) => /впереди|ahead/.test(t)).length, even = labels.filter((t) => /равны|even/.test(t)).length;
      if (diff === 0 ? even !== 2 : ahead !== 1) BAD.push(`${L}: pips ${pa}/${pc}: found ahead=${ahead} even=${even}`);
    }
    await p.close();
  }
  await b.close();
  console.log(BAD.length ? BAD.join('\n') : 'hud gate: 0 offenders'); console.log(`offenders=${BAD.length}`);
  process.exit(BAD.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
```
Run on the base: `node e2e/hud.e2e.cjs > /tmp/g2-base.txt; echo "exit=$?"` → **`exit=1`** with `found 0 ".strip", expected 2`. Paste into `GATES.md` G2 EVIDENCE. (`exit=2` = crash, not red.)

- [ ] **Step 1: `GameHud.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { Icon } from '../components/icons';

export interface StripProps {
  name: string; offline: boolean; mine: boolean; active: boolean; statusText: string;
  pips: number; pipDiff: number;            // pipDiff > 0: this side is ahead by that many pips
  off: number; score: number; cube: ReactNode | null; pieceChip: ReactNode;
  bank: string | null; move: string | null; low: boolean;
}
export function PlayerStrip(p: StripProps) {
  const T = useT();
  const diff = p.pipDiff > 0 ? `${T.pipsAhead} ${p.pipDiff}` : p.pipDiff === 0 ? T.pipsEven : '';
  return (
    <div className={'strip' + (p.active ? ' active' : '') + (p.mine ? ' mine' : '')}>
      {p.pieceChip}
      <div className="strip-main">
        <div className="strip-name"><b title={p.name}>{p.name}</b>{p.offline && <span className="tag warn">{T.offline}</span>}{p.active && <span className="turn-now">{p.statusText}</span>}</div>
        <div className="pmeta" data-pips={p.mine ? 'me' : 'opp'}>{p.pips} {T.pips} · {p.off}/15</div>
        {diff && <span className={'pdiff' + (p.pipDiff > 0 ? ' ahead' : '')}>{diff}</span>}
      </div>
      <span className="strip-score" title={T.score}>{p.score}</span>
      {p.cube}
      {(p.bank || p.move) && <div className="strip-timers"><span className="bank-time" title={T.bank}>{p.bank ?? '—'}</span><span className={'move-time' + (p.low ? ' low' : '')} title={T.moveTimer}>{p.move ?? '—'}</span></div>}
    </div>
  );
}

export interface ActionBarProps {
  canUndo: boolean; undoCountdownMs: number | null; undo: () => void;
  canDone: boolean; done: () => void;
  onReact: (emoji: string) => void; emojis: readonly string[];
  onChat: (() => void) | null; chatDot: boolean;
  extra: ReactNode;                        // double / claim buttons, passed through
}
export function ActionBar(p: ActionBarProps) {
  const T = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="action-bar">
      <div className="react-wrap">
        <button className="round" aria-label={T.reactions} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="smile" /></button>
        {open && <div className="react-pop" role="menu">{p.emojis.map((e) => <button key={e} role="menuitem" aria-label={e} onClick={() => { p.onReact(e); setOpen(false); }}>{e}</button>)}</div>}
      </div>
      {p.onChat && <button className="round" aria-label={T.chat} onClick={p.onChat}><Icon name="chat" />{p.chatDot && <i className="dot" />}</button>}
      <button className={'btn' + (p.undoCountdownMs !== null ? ' primary undo-send' : '')} disabled={!p.canUndo} onClick={p.undo}>
        <Icon name="undo" size={16} /> {T.undo}
        {p.undoCountdownMs !== null && <i className="countdown" style={{ ['--ms' as string]: `${p.undoCountdownMs}ms` }} />}
      </button>
      <button className="btn primary" disabled={!p.canDone} onClick={p.done}><Icon name="check" size={16} /> {T.done}</button>
      {p.extra}
    </div>
  );
}
```
`T.undo` / `T.done` text must be exactly `Отменить` / `Готово` without the old `↶ ` / `✓ ` glyph prefixes: check `i18n.ts`; if the strings contain the glyphs, strip them there **and** keep the e2e replacement in the table above consistent.

- [ ] **Step 2: Compose in `Game.tsx`** (logic untouched; markup only). Values already in scope: `board, viewer, opp, act, m, g, st, clocks, serverNow, pending, sent, busy, sendAt, turnDone, paused, undo, submit, UNDO_MS, compact, wide, hud, statusText, mayDouble, doubled, canClaim, moreOpen, setMoreOpen, chatOpen, setChatOpen, EMOJIS, pipCount, other`.

  1. **Root class:** `className={'game theme-' + st.theme + (compact ? ' phone-game' : '') + (wide ? ' desk2' : '') + (wide && g.mode === 'online' ? ' has-chat' : '')}`.
  2. **Strip builder** — replace the `hud` branch of `playerBar` with:
  ```tsx
  const strip = (c: Color) => {
    const p = g.players[c], clk = clockFor(c), running = act === c && clocks?.turnStartedAt != null;
    const elapsed = running ? Math.max(0, serverNow - clocks!.turnStartedAt!) : 0;
    const bankLeft = clocks?.bank ? clocks.bank[c] - (running ? Math.max(0, elapsed - clocks.moveTimerMs) : 0) : null;
    const moveLeft = clocks?.moveTimerMs ? Math.max(0, clocks.moveTimerMs - elapsed) : null;
    const mine = g.mode === 'local' ? c === viewer : c === viewer;
    return <PlayerStrip key={c} name={p?.name ?? '—'} offline={!!p && !p.connected} mine={mine} active={act === c} statusText={statusText}
      pips={pipCount(board, c)} pipDiff={pipCount(board, other(c)) - pipCount(board, c)} off={board.off[c]} score={m.score[c]}
      cube={m.cube.owner === c && m.settings.cube ? <Cube value={m.cube.value} /> : null}
      pieceChip={<span className={'pchip ' + (c === 0 ? 'w' : 'b')} data-theme-chip={st.theme} />}
      bank={bankLeft === null ? null : fmt(bankLeft)} move={moveLeft === null ? null : fmt(moveLeft)} low={!!clk?.low} />;
  };
  ```
  `pipDiff` is positive for the side with **fewer** pips (it is ahead). `data-pips="me|opp"` and `.pmeta` text are preserved inside `PlayerStrip` (e2e compares numeric/off text; each page must still have exactly 2 `.pmeta`). Diff goes in sibling `.pdiff`; G2 reads `.pdiff` for leader/even counts.
  3. **ActionBar props** (derive from existing state; the old rules were: undo shown when `pending && !sent && pending.chains.length > 0`, disabled `= chains.length===0 || busy` unless the countdown runs; Done shown when `!st.autoConfirm || paused`):
  ```tsx
  const hasPending = !!pending && !sent && pending.chains.length > 0;
  const actionBar = <ActionBar
    canUndo={hasPending && (sendAt !== null || !busy)} undoCountdownMs={sendAt !== null ? UNDO_MS : null} undo={undo}
    canDone={hasPending && turnDone && !busy && (!st.autoConfirm || paused)} done={submit}
    onReact={(e) => ctrl.emoji(e)} emojis={EMOJIS}
    onChat={g.mode === 'online' && compact ? () => setChatOpen((o) => !o) : null} chatDot={g.chat.length > 0 && !chatOpen}
    extra={<>{canClaim && <button className="btn gold" onClick={() => ctrl.claim()}>{T.claimWin}</button>}
      {mayDouble && !doubled && <button className="btn gold" onClick={() => { setDoubled(true); ctrl.double(); }}>×2 {T.double}{st.autoRoll && <i className="countdown" style={{ ['--ms' as string]: `${DOUBLE_MS}ms` }} />}</button>}</>} />;
  ```
  4. **Visually-hidden status** (keeps every `.status` e2e reader working and gives a live region): `<span className="status sr-status" role="status">{statusText}</span>` rendered **once** inside `compact`/`wide` HUD; the old HUD copy is replaced; the legacy `!hud` `.status` remains.
  **Header/menu contract for hud:** keep the existing gear button with `aria-label={T.settings}` (PREVIEW opens it directly). Add a separate dots Icon button with `aria-label={T.more}`. When open, `phone-more` contains settings (`T.settings`), resign (`T.resign`, no flag glyph) and an Icon close button with `aria-label={T.back}`; resign still opens `resignConfirm`. Never render a second always-visible settings button. Wide match meta is `<small className="desk-meta">` with match length, variant and Crawford marker.
  5. **Phone (`compact`):** order inside `.game`: `game-top` header (back, score `<small>` kept incl. Crawford, `game-top-actions` incl. `⋯`), `strip(opp)` **above** the board, board, then `<div className="mobile-hud">{strip(viewer)}{actionBar}</div>` (class `.mobile-hud` kept: PREVIEW_ONLY measures it). Delete `.quick-social`/`.quick-reactions`, the old `.controls` middle block and the old `.emoji-bar` inside `phone-more`. `phone-more` now holds only **settings** (`setSettingsOpen(true)`) and **resign** (`setConfirmResign(true)`); the `⋯` button in `game-top-actions` (`aria-label={T.more}`) toggles `moreOpen`.
  6. **Desktop (`wide`):** reuse the existing CSS grid. Children, in DOM order, each with a class that `game-hud.css` maps to a grid area: `game-top` (`top`; contains back, small meta incl. `T.matchLength N · variant` and Crawford, and the `⋯` button), `<div className="desk-score">{m.score[0]} : {m.score[1]}</div>` (`score`), `strip(opp)` wrapped in `<div className="area-opp">`, `<aside className="chat">` (`chat`, online only — unchanged component), `<div className="mobile-hud">{strip(viewer)}{actionBar}</div>` (`me`), board (`board`). Hide the header `.score` block when `wide`. Delete the standalone `.resign` button, `desk-more`, the `emoji-bar` from the wide HUD only; resign/settings live in the same `phone-more` popover (reused for wide; position it under the header).
  7. **Cleanup:** remove what becomes unused in the new HUD (`quick-reactions` markup, the old `hud` branch in `playerBar`); preserve `desk-more`/`.emoji-bar` in `!hud`; `playerBar` stays for the legacy path. `npm run typecheck` must exit 0 (`noUnusedLocals`).

- [ ] **Step 3: `game-hud.css`** (import it in `Game.tsx` after the existing imports; every override has ≥ the specificity of what it overrides — `.game:not(.phone-game) .x` is (0,3,0), tying `.game.desk2 .x`; the later bundle order from Task 1 breaks the tie. The root `.game:not(.phone-game)` alone is (0,2,0)):

```css
.game .strip { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 14px; background: var(--panel); border: 1px solid var(--panel-b); min-height: 56px; width: 100%; }
.game .strip.active { background: var(--bg2); border: 1.5px solid var(--accent); }
.game .strip-main { flex: 1; min-width: 0; }
.game .strip-name { display: flex; align-items: baseline; gap: 8px; }
.game .turn-now { font-size: 13px; font-weight: 700; color: var(--accent); }
.game .strip .pmeta { font-size: 13px; margin: 0; opacity: .85; white-space: normal; overflow: visible; text-overflow: clip; }
.game .strip .pdiff { font-size: 13px; }
.game .strip .pdiff.ahead { color: var(--ok); font-weight: 700; }
.game .strip .tag.warn { font-size: 11px; }
.game .strip-timers { display: flex; flex-direction: column; gap: 2px; font-size: 12px; font-variant-numeric: tabular-nums; }
.game .mobile-hud { display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: auto; grid-template-columns: none; }
.game.phone-game .mobile-hud { margin-top: 0; flex: 1; }
.game.phone-game .action-bar { margin-top: auto; }
.game .action-bar { display: flex; align-items: center; gap: 8px; }
.game .action-bar .btn { flex: 1; min-height: 48px; }
.game .action-bar .round { width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--panel-b); background: var(--panel); color: var(--text); display: grid; place-items: center; position: relative; flex: none; }
.game .action-bar .round .dot { position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
.game .react-wrap { position: relative; }
.game .react-pop { position: absolute; bottom: 56px; left: 0; display: flex; gap: 4px; padding: 6px; background: var(--bg); border: 1px solid var(--panel-b); border-radius: 14px; box-shadow: 0 6px 30px #0008; z-index: 10; }
.game .react-pop button { width: 44px; height: 44px; border: 0; background: transparent; font-size: 22px; }
.game .game-top .icon-btn { width: 44px; height: 44px; }
.sr-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* desktop: re-assign the existing grid areas */
.game.desk2 { grid-template-columns: minmax(0, 1fr) 340px; grid-template-rows: auto auto auto minmax(0, 1fr) auto; grid-template-areas: 'top top' 'board score' 'board opp' 'board chat' 'board me'; }
.game.desk2:not(.has-chat) { grid-template-rows: auto auto auto auto minmax(0, 1fr); grid-template-areas: 'top top' 'board score' 'board opp' 'board me' 'board .'; }
.game.desk2 .desk-score { grid-area: score; text-align: center; font-size: 40px; font-weight: 800; font-variant-numeric: tabular-nums; }
.game.desk2 .area-opp { grid-area: opp; }
.game.desk2 .mobile-hud { grid-area: me; margin-top: 0; }
.game.desk2 .chat { grid-area: chat; align-self: stretch; }
```
The old desktop/social selectors still serve the legacy `!hud` path; keep their markup and CSS. New hud markup does not use them. Phone flex slack belongs between own strip and action bar; do not remove bottom pinning just to satisfy G2.

- [ ] **Step 4: e2e selectors** — apply the table rows for Task 6 in `e2e/online.e2e.cjs` (`grep -n "✓\|Отменить\|pbar\|emoji-bar\|nth(5)" e2e/online.e2e.cjs`, edit each hit). `.status` readers need **no** change (hidden status element).

- [ ] **Step 5: Verify** (each exit code read from the command):

```bash
npm run typecheck; echo tc=$?; npm run build; echo build=$?
node e2e/hud.e2e.cjs > /tmp/g2.txt; echo "exit=$?"; cat /tmp/g2.txt
node e2e/online.e2e.cjs > /tmp/e2e.txt; echo "exit=$?"
```
Expected `exit=0` each; `offenders=0`. Manual in the browser, wood + minimal + malachite at 360: select a checker → exactly one `[data-hint="selected"]` and ≥1 `[data-hint="target"]` (the green selection from `fe762f2` unchanged); Undo disabled → enabled after a move → pip count returns after Undo; the reaction popover opens and sends; ⋯ → resign dialog still asks `resignConfirm`. At 1440 online (two contexts as in `online.e2e.cjs`): chat panel sits between the opponent and own strips, resign only via ⋯. **768×1024 portrait:** the legacy layout renders unchanged (`.pbar` present, no `.strip`) — record that as the expected state.

- [ ] **Step 6: Commit** `git add e2e/hud.e2e.cjs apps/web/src/screens/GameHud.tsx apps/web/src/screens/game-hud.css apps/web/src/screens/Game.tsx e2e/online.e2e.cjs GATES.md && git commit -m "feat(web): game HUD — player strips, action bar, reactions popover, desktop column"`

---

### Task 7: Final verification

- [ ] **Step 1: List every e2e mode** — `grep -n "_ONLY" e2e/online.e2e.cjs` (currently LAYOUT_ONLY, INPUT_ONLY, STATES_ONLY, PREVIEW_ONLY, GHOST_ONLY, REVIEW_ONLY, BOARD_ONLY modifier, REJOIN_ONLY, RECOVERY_ONLY, T2_ONLY; the handover lists the invocations at `docs/superpowers/plans/2026-11-15-claude-handover.md:134-156`, LAYOUT_ONLY needs `HINT_GATE=1 TASK=verification`).
- [ ] **Step 2: Run each mode separately, exit code read per run**

```bash
# bash (zsh does not word-split $m the same way); retain a log per mode.
bash <<'RUN_MODES'
failed=0
for m in "DEFAULT" "LAYOUT_ONLY=1 HINT_GATE=1 TASK=verification" "STATES_ONLY=1" "GHOST_ONLY=1" "PREVIEW_ONLY=1" "INPUT_ONLY=1" "REVIEW_ONLY=1" "REVIEW_ONLY=1 BOARD_ONLY=1" "REJOIN_ONLY=1" "RECOVERY_ONLY=1" "T2_ONLY=1"; do
  read -r -a flags <<< "$m"
  label=${flags[0]%%=*}
  [[ "$m" == "REVIEW_ONLY=1 BOARD_ONLY=1" ]] && label=BOARD_ONLY
  [[ "$m" == DEFAULT ]] && flags=()
  env "${flags[@]}" node e2e/online.e2e.cjs "/tmp/nardy-$label" > "/tmp/e2e-$label.txt" 2>&1
  result=$?
  echo "[$m] exit=$result log=/tmp/e2e-$label.txt"
  [[ $result -ne 0 ]] && failed=1
done
exit "$failed"
RUN_MODES
```
These modes currently hard-code tracked screenshot paths under `docs/design/impl-screens`, ignoring the output argument in several helpers. Before running, record a clean baseline and list those tracked paths. Afterward restore **only tracked historical PNGs overwritten by the runs**, using explicit paths from `git diff --name-only -- docs/design/impl-screens` and the pre-run list. Do not blanket restore the directory or discard owner files/new redesign screenshots. New final screenshots use `redesign-*`; keep those. Alternatively add an `IMPL_SCREEN_DIR` override to every hard-coded writer and run with a tmp directory (record this intentional test-only change).

- [ ] **Step 3: Re-baseline PREVIEW_ONLY geometry** (`:353` area: board top, `bottomGap` on `.mobile-hud`) from the **measured** new values at 360×780; change the constants deliberately and say so in the commit message. Fix any `.status`/selector line in the other modes that now fails, using the table.
- [ ] **Step 4: Totals**

```bash
npm run typecheck; echo tc=$?; npm test; echo test=$?; npm run build; echo build=$?
node e2e/screens.e2e.cjs > /tmp/g1.txt; echo "g1=$?"; node e2e/hud.e2e.cjs > /tmp/g2.txt; echo "g2=$?"
```
All `=0`. Paste green tails into `GATES.md`.
- [ ] **Step 5: Screenshots** at 360/768/1440 × wood/minimal/malachite for home, setup, lobby (mock), waiting, game phone, game desktop, plus a 20-character name on `/ai` and `/online` at 360; save to `docs/design/impl-screens/redesign-<screen>-<w>-<theme>.png`; compare to the canvas frames; **name every difference** («at 360: waiting params card 12px lower than canvas»).
- [ ] **Step 6: Commit** `git add e2e/online.e2e.cjs docs/design/impl-screens/redesign-*.png GATES.md && git commit -m "test: re-baseline preview geometry; redesign screenshots; gate evidence"`
- [ ] **Step 7: Final implementation review** — separate from the **completed two** plan-review rounds. Use available independent reviewer tooling with the complete final diff, resolve material findings, and rerun affected checks. The owner requested Opus advisor + Sonnet medium executor for Claude implementation; do not guess an unavailable Codex model ID or restart plan review. If a required reviewer/model is unavailable, report that limitation precisely; never claim independent review passed. No push/merge/deploy is authorized by this step.

---

## Self-review against the spec

| Spec section | Task |
|---|---|
| База — merge polish branches | 0 |
| Пункт 1 Главная / Игра с ботом / Лобби / Ожидание | 2 / 3 / 4 / 5 (deviations listed above) |
| Пункт 1 Десктоп 768/1440 | `.screen.*2` `max-width`, bottom bars `max-width: 528px`; gate runs 360/768/1440 × ru/en |
| Пункт 2 Телефон 360 | 6 |
| Пункт 2 Десктоп 1440 | 6 (existing grid re-assigned; no chat tab — the log is out of scope) |
| Читатели общих полей | Global Constraints table; i18n (1); `.back` readers (2); `.pmeta`/`.status` (6) |
| Проверка | G1 (5), G2 (6), all e2e modes (7), screenshots (7) |

**Known gaps, stated:** 768 portrait game keeps the legacy layout (decision 7); desktop HUD gate runs in local mode (no chat) — the chat placement is checked by hand and by the online e2e; no web unit tests exist (pip diff is gate-verified live); contrast of `#1a0d06` on `--accent` per theme was not measured by the reviewers — calculate the WCAG ratio for all themes during Task 7 (≥4.5:1 for normal text; visual inspection alone does not prove it). Resume card requires a saved-AI fixture; password/not-found branches and iOS-only motion permission UI need explicit coverage. The canvas is private; if unavailable, compare against the durable spec and state that visual canvas parity is unverified.
