# Screens Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw the four general screens (home, bot/local setup, online lobby, waiting room) and the game screen (phone and desktop) as approved on the design canvas, without touching game rules, protocol or the Worker.

**Architecture:** Client-only. New styles live in two new CSS files imported by their screens (`menus.css`, `game-hud.css`), so the shared `styles.css` is not edited. Icons are one small inline-SVG module. The game HUD moves out of the 760-line `Game.tsx` into one new component file. Acceptance is a Playwright gate script that names offenders (emoji in UI, horizontal overflow, tap targets < 44px) at 360/768/1440.

**Tech Stack:** React 19, Vite 8, zustand, Playwright (e2e, via `NODE_PATH` of the npx install), wrangler dev for the live check.

**Spec:** `docs/superpowers/specs/2026-11-15-screens-redesign-design.md`. **Canvas:** https://claude.ai/artifact/4VqvUkMd4pQ8eezACer2DB (private; the spec is the durable copy).

## Global Constraints

- `packages/core`, `worker/`, protocol files: **not touched**. (spec, «Инвариант»)
- Out of scope: move log, last-move line, «Сразу» + remembered params, open-room counter, board/checker/dice changes. (spec, «Вне объёма»)
- Tap targets ≥ 44px; text contrast ≥ 4.5:1; no emoji used as icons in new/changed UI (SVG or text).
- Existing classes `.link`, `.btn`, `.btn.big`, `.seg`, `.field`, `.card`, `.page-head` are **not redefined**; new rules go under new class names. (spec, «Читатели общих полей»)
- Selectors e2e relies on survive or are updated in the same task: `[data-pips="me"]`, `.pmeta`, `.mobile-hud`, `[data-hint=…]`, `.board-wrap`, button names `↶ Отменить`, `✓ Готово`. (`e2e/online.e2e.cjs:44,69,196,202,346,350,353,371,431`)
- Themes: wood, minimal, malachite all keep working; use existing CSS variables (`--bg --text --muted --accent --panel --panel-b --ok --danger`), no new colors except via these.
- Commit one task = one commit, explicit `git add <paths>` only (never `-A`).

## Findings that change the spec (checked in code, 2026-11-15)

1. **No "close room" in the Worker.** `worker/src/room.ts` only closes sockets on bad password / full / gone / expiry (`:146 :206 :212 :419`). A creator cannot close a room. So the waiting-room button is **«Выйти»** (navigates to `/online`), not «Закрыть комнату». The spec line 38 is amended in Task 5.
2. **«Видна в лобби»** is honest: `room.settings.isPublic` exists (`packages/core/src/protocol.ts:17`, `RoomView.settings`).
3. **`CreateRoom`** (`Menus.tsx`) is not on the canvas and not in the spec. It stays as is; it only inherits the new `NameChip` if Task 2 changes the shared name field — it does **not** (see Task 2).
4. **`Game.tsx` imports `SettingsScreen` from `Menus.tsx`; `Room.tsx` imports `PageHead` from `Menus.tsx`.** Reads count as ownership, so Menus work and Game/Room work cannot run in parallel. All batches below are sequential.
5. The old `GATES.md` does not exist in the repo; Task 1 creates it for this work.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/components/icons.tsx` | create | 12 inline SVG icons, one `Icon` component, `aria-hidden` |
| `apps/web/src/screens/menus.css` | create | Styles for new home/setup/lobby/waiting markup, imported by `Menus.tsx` |
| `apps/web/src/screens/Menus.tsx` | modify | `Home`, `GameSetup`, `Online`, new `NameChip` |
| `apps/web/src/screens/Room.tsx` | modify | waiting-room block only (`if (!match) {…}`) |
| `apps/web/src/screens/GameHud.tsx` | create | `PlayerStrip`, `ActionBar`, `ReactionsPopover` |
| `apps/web/src/screens/game-hud.css` | create | HUD + desktop column styles, imported by `Game.tsx` |
| `apps/web/src/screens/Game.tsx` | modify | compose new HUD, desktop column; no logic changes |
| `apps/web/src/lib/i18n.ts` | modify | new keys in **both** `ru` and `en` (Task 1) |
| `e2e/screens.e2e.cjs` | create | acceptance gate (Task 1) |
| `e2e/online.e2e.cjs` | modify | selector updates only (Task 7) |
| `GATES.md` | create | gate registry (Task 1) |

## Batch map (sequential; one writer per file; model per task)

| Batch | Task | Owns (writes) | Reads | Model |
|---|---|---|---|---|
| 0 | 0 Base merge | git history, `styles.css` conflict | — | Opus (orchestrator) |
| 1 | 1 Gate + i18n keys | `e2e/screens.e2e.cjs`, `GATES.md`, `lib/i18n.ts` | — | Sonnet |
| 2 | 2 Icons + Home | `components/icons.tsx`, `screens/menus.css`, `Menus.tsx` (Home, NameChip) | i18n | Sonnet |
| 3 | 3 Setup | `Menus.tsx` (GameSetup), `menus.css` | icons, i18n | Sonnet |
| 4 | 4 Lobby | `Menus.tsx` (Online), `menus.css` | icons, i18n | Sonnet |
| 5 | 5 Waiting room | `Room.tsx`, `menus.css`, spec line 38 | Menus.tsx | GPT-5.6-Sol |
| 6 | 6 Game HUD | `GameHud.tsx`, `game-hud.css`, `Game.tsx` | Menus.tsx, store | GPT-5.6-Sol |
| 7 | 7 e2e selectors + final verify | `e2e/online.e2e.cjs` | all | Opus |

After each batch: Opus reads the diff, runs `npm run typecheck && npm test && npm run build`, runs the gate. Next batch starts only after that.

---

### Task 0: Base — merge the two polish branches

**Files:** git only; conflict expected in `apps/web/src/styles.css`.

- [ ] **Step 1: Branch from the spec branch**

```bash
cd /Users/oleksandrkhaliavinskyi/Projects/Backgammon
git status --short            # must be clean before anything
git switch -c feat/screens-redesign docs/screens-redesign-spec
```

- [ ] **Step 2: Merge both polish branches**

```bash
git merge --no-ff claude/screens-polish-24f596 -m "Merge screens-polish: unified page header, cards, toggles"
git merge --no-ff claude/desktop-layout-4055b7 -m "Merge desktop-layout: board left, side column right"
```

If `styles.css` conflicts: both sides only **append** blocks (368 and 18 added lines). Keep both blocks, `screens-polish` first. Never take one side wholesale.

- [ ] **Step 3: Prove the base is green**

```bash
npm ci && npm run typecheck && npm test && npm run build
```
Expected: all exit 0. Read each exit code from the command itself, not through a pipe.

- [ ] **Step 4: Live baseline**

```bash
npm run build && (npm run dev:worker &) ; sleep 6
NARDY_URL=http://127.0.0.1:8787 NODE_PATH=$(npm root -g):$(ls -d ~/.npm/_npx/*/node_modules | head -1) node e2e/online.e2e.cjs; echo "exit=$?"
```
Expected: `exit=0`. If it is not 0 here, stop: the redesign must not start on a red base.

- [ ] **Step 5:** No commit needed (merge commits exist). Note the resulting SHA in the handoff.

---

### Task 1: Acceptance gate + i18n keys

**Files:**
- Create: `e2e/screens.e2e.cjs`, `GATES.md`
- Modify: `apps/web/src/lib/i18n.ts` (both `ru` and `en` objects)

**Interfaces:**
- Produces: i18n keys used by Tasks 2–6 — `playingAs`, `botLevelHint`, `startWith`, `cubeOnlyShort`, `howToPlay`, `newGame`, `resumeScore`, `filterAll`, `filterLong`, `filterShort`, `haveCode`, `byPassword`, `enter`, `roomCode`, `shareLink2`, `copyLink`, `leaveRoom`, `visibleInLobby`, `hiddenFromLobby`, `access`, `accessOpen`, `accessPassword`, `reactions`, `pipsAhead`, `pipsEven`, `moreActions`, `tabChat`.
- Produces: `node e2e/screens.e2e.cjs` exits non-zero and prints one line per offender.

- [ ] **Step 1: Write the gate**

```js
// e2e/screens.e2e.cjs — usage: NARDY_URL=http://127.0.0.1:8787 node e2e/screens.e2e.cjs
const { chromium } = require('playwright');
const BASE = process.env.NARDY_URL || 'http://127.0.0.1:8787';
const WIDTHS = [360, 768, 1440];
const ROUTES = ['/', '/ai', '/local', '/online', '/settings'];
// pictographic emoji used as UI glyphs (excludes plain arrows/check marks used as text)
const EMOJI = /\p{Extended_Pictographic}/u;
const BAD = [];

(async () => {
  const browser = await chromium.launch();
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
    const p = await ctx.newPage();
    for (const r of ROUTES) {
      await p.goto(BASE + r);
      await p.waitForLoadState('networkidle');
      const found = await p.evaluate(({ emojiSrc }) => {
        const re = new RegExp(emojiSrc, 'u');
        const out = [];
        const vw = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > vw) out.push(`overflow-x: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
        for (const el of document.querySelectorAll('button, a, h1, h2, h3, summary, label, span.ico')) {
          const t = (el.textContent || '').trim();
          if (re.test(t)) out.push(`emoji in <${el.tagName.toLowerCase()}>: "${t.slice(0, 30)}"`);
        }
        for (const el of document.querySelectorAll('button, a[href], input, summary')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (b.height < 44 && b.width < 44) out.push(`tap target ${Math.round(b.width)}x${Math.round(b.height)}: "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`);
          else if (b.height < 44 && el.tagName !== 'INPUT') out.push(`tap height ${Math.round(b.height)}: "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`);
        }
        return out;
      }, { emojiSrc: EMOJI.source });
      for (const f of found) BAD.push(`${w} ${r}: ${f}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(BAD.length ? BAD.join('\n') : 'screens gate: 0 offenders');
  console.log(`offenders=${BAD.length}`);
  process.exit(BAD.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
```

- [ ] **Step 2: Run against the current base — it MUST fail naming emoji**

```bash
NARDY_URL=http://127.0.0.1:8787 NODE_PATH=... node e2e/screens.e2e.cjs; echo "exit=$?"
```
Expected: `exit=1`, lines like `360 /: emoji in <button>: "🌐 Играть онлайн"`. If it prints `0 offenders` the gate is broken (satisfied by deleting the feature): fix it before going on. Paste the first 5 lines into `GATES.md` as EVIDENCE.

- [ ] **Step 3: `GATES.md`**

```markdown
# Gates — screens redesign
## G1 general screens
OWNS: apps/web/src/screens/Menus.tsx, Room.tsx, menus.css
CHECK: NARDY_URL=http://127.0.0.1:8787 node e2e/screens.e2e.cjs
EXPECT: exit 0, "offenders=0"
EVIDENCE: red on base (paste first lines here), green after Task 5
## G2 game HUD
OWNS: apps/web/src/screens/GameHud.tsx, game-hud.css, Game.tsx
CHECK: node e2e/online.e2e.cjs
EXPECT: exit 0
EVIDENCE: filled in Task 7
```

- [ ] **Step 4: Add the i18n keys** to both `ru` and `en` blocks of `apps/web/src/lib/i18n.ts`. Exact values:

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
| `moreActions` | `Ещё` | `More` |
| `tabChat` | `Чат` | `Chat` |

`resumeScore`: not added (the saved AI game exposes no score here — «Продолжить» keeps its current text).

- [ ] **Step 5: Verify** `npm run typecheck` → 0 (i18n objects are typed by `ru`; a key missing in `en` must fail here). Commit:

```bash
git add e2e/screens.e2e.cjs GATES.md apps/web/src/lib/i18n.ts
git commit -m "test: screens acceptance gate; i18n keys for redesign"
```

---

### Task 2: Icons + Home

**Files:**
- Create: `apps/web/src/components/icons.tsx`, `apps/web/src/screens/menus.css`
- Modify: `apps/web/src/screens/Menus.tsx` (`Home`, add `NameChip`, import css)

**Interfaces:**
- Produces: `export function Icon({ name, size }: { name: IconName; size?: number }): JSX.Element` with `IconName = 'globe'|'robot'|'people'|'gear'|'chevron'|'back'|'dots'|'share'|'copy'|'refresh'|'lock'|'smile'|'undo'|'check'|'book'|'edit'|'chat'|'plus'`.
- Produces: `export function NameChip(): JSX.Element` (inline edit of `useSettings().name`); used by Tasks 3–4.

- [ ] **Step 1: `icons.tsx`** — one switch, stroke icons, `aria-hidden`:

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

- [ ] **Step 2: `NameChip` and `Home` in `Menus.tsx`.** Add `import './menus.css'; import { Icon } from '../components/icons';`. `NameChip` toggles between a button and an input:

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

`Home` body (keep `saved`, `unlockAudio`, `nav` behaviour exactly; only markup/classes change):

```tsx
<div className="screen home2">
  <header className="home2-head">
    <span className="home2-brand"><Logo /><b>{T.appName}</b></span>
    <button className="icon-btn" aria-label={T.settings} onClick={() => nav('/settings')}><Icon name="gear" /></button>
  </header>
  {saved && (
    <button className="resume-card" onClick={() => nav('/play?resume=1')}>
      <span className="resume-play" aria-hidden><Icon name="chevron" /></span>
      <span className="grow"><b>{T.continueGame}</b></span>
    </button>
  )}
  <div className="eyebrow">{T.newGame}</div>
  <button className="menu-row primary" onClick={() => (unlockAudio(), nav('/online'))}>
    <Icon name="globe" size={26} /><span className="grow"><b>{T.playOnline}</b></span><Icon name="chevron" />
  </button>
  <button className="menu-row" onClick={() => (unlockAudio(), nav('/ai'))}>
    <Icon name="robot" size={26} /><span className="grow"><b>{T.playAi}</b></span><Icon name="chevron" />
  </button>
  <button className="menu-row" onClick={() => (unlockAudio(), nav('/local'))}>
    <Icon name="people" size={26} /><span className="grow"><b>{T.playLocal}</b></span><Icon name="chevron" />
  </button>
  <details className="rules home2-rules">
    <summary><Icon name="book" /> {T.howToPlay}</summary>
    <h3>{T.long}</h3><p>{T.rulesLong}</p><h3>{T.short}</h3><p>{T.rulesShort}</p>
  </details>
</div>
```

`Logo` stays the existing component, rendered small via CSS (`.home2-brand svg, .home2-brand img {width:36px;height:36px}`) — check `Logo.tsx` output first; if it renders a fixed 120px element, pass nothing and size it by CSS.

- [ ] **Step 3: `menus.css`** (all new class names; tokens only):

```css
.home2 { max-width: 560px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 20px; justify-content: flex-start; }
.home2-head { display: flex; align-items: center; justify-content: space-between; min-height: 48px; }
.home2-brand { display: flex; align-items: center; gap: 10px; font-size: 22px; }
.home2-brand > :first-child { width: 36px; height: 36px; }
.eyebrow { font-size: 13px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); padding: 6px 4px 0; }
.menu-row { display: flex; align-items: center; gap: 14px; min-height: 76px; padding: 14px 16px; border-radius: 18px; background: var(--panel); border: 1px solid var(--panel-b); color: var(--text); font-size: 17px; text-align: left; cursor: pointer; }
.menu-row.primary { background: var(--accent); border-color: var(--accent); color: #1a0d06; }
.menu-row .grow { flex: 1; }
.resume-card { display: flex; align-items: center; gap: 14px; padding: 16px; border-radius: 18px; background: var(--bg2); border: 1px solid var(--accent); color: var(--text); cursor: pointer; min-height: 64px; }
.resume-play { width: 44px; height: 44px; border-radius: 50%; background: var(--accent); color: #1a0d06; display: grid; place-items: center; }
.home2-rules { margin-top: auto; }
.home2-rules summary { min-height: 44px; display: flex; align-items: center; gap: 10px; }
.name-chip { align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border-radius: 22px; border: 1px solid var(--panel-b); background: var(--panel); font-size: 14px; cursor: pointer; }
.name-input { align-self: flex-start; min-height: 44px; padding: 0 14px; border-radius: 22px; border: 1px solid var(--accent); background: var(--panel); color: var(--text); font-size: 16px; }
@media (min-width: 900px) { .home2 { padding-top: 48px; } }
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm run build        # both exit 0
NARDY_URL=http://127.0.0.1:8787 node e2e/screens.e2e.cjs | grep " /:" ; echo
```
Expected: no `/:` offender lines left for emoji or tap targets on `/` at 360/768/1440 (other routes still red — that is correct at this point). Open `/` at 360 and 1440 in the browser pane: one gold row, no overflow, console clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/icons.tsx apps/web/src/screens/menus.css apps/web/src/screens/Menus.tsx
git commit -m "feat(web): home screen — svg icons, resume card, compact header"
```

---

### Task 3: Setup screen (bot / local)

**Files:** Modify `apps/web/src/screens/Menus.tsx` (`GameSetup`, `VariantPicker`), `apps/web/src/screens/menus.css`.

**Interfaces:** Consumes `NameChip`, `Icon`, i18n keys from Tasks 1–2. Navigation URL unchanged: `/play?mode=…&variant=…&len=…&cube=…&level=…` (e2e and `LocalGame` read it).

- [ ] **Step 1: Replace `VariantPicker`** with two cards, keep `aria-pressed` semantics via `role="radio"`:

```tsx
function VariantPicker({ value, onChange }: { value: Variant; onChange: (v: Variant) => void }) {
  const T = useT();
  const opts: { v: Variant; label: string; sub: string }[] = [
    { v: 'long', label: T.long, sub: T.longDesc },
    { v: 'short', label: T.short, sub: T.shortDesc },
  ];
  return (
    <div className="variant-cards" role="radiogroup" aria-label={T.variant}>
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={o.v === value} className={'variant-card' + (o.v === value ? ' on' : '')} onClick={() => onChange(o.v)}>
          <b>{o.label}</b>
          <span>{o.sub}</span>
        </button>
      ))}
    </div>
  );
}
```

`VariantPicker` is also used by `CreateRoom`; that screen gets the cards too — acceptable and consistent. Check `CreateRoom` at 360 in Step 5.

- [ ] **Step 2: Replace `GameSetup` markup.** Logic (state, URL) unchanged. Structure: header (`PageHead`), `NameChip`, `Variant` eyebrow + `VariantPicker`, **cube row always rendered**, level segment (`ai` only) with `T.botLevelHint`, match segment, bottom bar.

```tsx
<div className="screen form setup2">
  <PageHead title={mode === 'ai' ? T.playAi : T.playLocal} onBack={() => nav('/')} />
  <NameChip />
  <div className="eyebrow">{T.variant}</div>
  <VariantPicker value={variant} onChange={setVariant} />
  <label className={'switch-row' + (variant === 'short' ? '' : ' off')}>
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
      {T.startWith} · {variant === 'long' ? T.long : T.short} · {len}
    </button>
  </div>
</div>
```

Note the URL: `cube` is sent as `0` for long (it was `cube ? 1 : 0` before — for long the value is ignored by the engine; sending 0 is equivalent and avoids a stale `true`). Verify with Step 4.

- [ ] **Step 3: CSS** in `menus.css`:

```css
.variant-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.variant-card { text-align: left; padding: 14px; min-height: 96px; border-radius: 16px; background: var(--panel); border: 2px solid var(--panel-b); color: var(--text); display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
.variant-card.on { border-color: var(--accent); background: var(--bg2); }
.variant-card b { font-size: 17px; }
.variant-card span { font-size: 14px; line-height: 1.35; color: var(--muted); }
.switch-row { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 4px; }
.switch-row.off { opacity: .55; }
.switch-row small { color: var(--muted); }
.hint { margin: -4px 4px 0; font-size: 14px; }
.setup2 { padding-bottom: 96px; }
.bottom-bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px max(16px, env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--panel-b); display: flex; justify-content: center; z-index: 5; }
.bottom-bar .btn { width: 100%; max-width: 528px; }
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm run build`; gate output for `/ai` and `/local` has no emoji/overflow/tap lines; then in the browser at 360: choose Short + 3 + Start, confirm the game URL contains `variant=short&len=3&cube=1`; choose Long, confirm `cube=0`.

- [ ] **Step 5: Check `/create` at 360** (shares `VariantPicker`): no overflow, console clean.

- [ ] **Step 6: Commit** `git add apps/web/src/screens/Menus.tsx apps/web/src/screens/menus.css && git commit -m "feat(web): setup screen — name chip, variant cards, cube switch, bottom start bar"`

---

### Task 4: Online lobby

**Files:** Modify `Menus.tsx` (`Online`), `menus.css`.

**Interfaces:** Consumes `LobbyEntry` (`id, host, settings{variant,matchLength,moveTimer,bank,cube,isPublic}, hasPassword`) — no protocol change.

- [ ] **Step 1:** In `Online`, add `const [filter, setFilter] = useState<'all' | Variant>('all');` and `const shown = rooms?.filter((r) => filter === 'all' || r.settings.variant === filter);`. Replace `timerLabel` with chip builder:

```tsx
const chips = (s: RoomSettings) => [
  s.variant === 'long' ? T.long : T.short,
  `${T.matchLength} ${s.matchLength}`,
  s.moveTimer || s.bank ? [s.moveTimer && `${s.moveTimer} ${T.sec}`, s.bank && `${s.bank / 60} ${T.min}`].filter(Boolean).join(' + ') : '∞',
  ...(s.cube ? [T.cube] : []),
];
```

- [ ] **Step 2: Markup** — `PageHead` title `T.playOnline`; `NameChip`; primary `Create room` button with `<Icon name="plus"/>` (replace `＋`); filter segment (`filterAll/Long/Short`) + refresh icon button (`aria-label={T.refresh}`); list heading `T.lobby · {shown?.length ?? 0}`; each room as `button.room-card2` with avatar initial, `host`, lock chip (`<Icon name="lock" size={12}/> {T.byPassword}` when `hasPassword`), chips, `T.enter`; empty state: plain text `T.noRooms`, no emoji, with the create button repeated is **not** added (YAGNI). Bottom bar: `<label htmlFor="code">{T.haveCode}</label>` + the existing `code-input` form (same regex and `nav('/r/' + c)`), submit button `T.enter`.

```tsx
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
```

The room code (`r.id`) is no longer shown in the list (the card is the join action). It was shown before (`<span className="code">{r.id}</span>`); this is a deliberate loss of information — noted in the Verify list, not silently dropped.

- [ ] **Step 3: CSS**

```css
.room-card2 { display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; min-height: 68px; border-radius: 16px; background: var(--panel); border: 1px solid var(--panel-b); color: var(--text); text-align: left; cursor: pointer; }
.avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--bg2); display: grid; place-items: center; font-weight: 800; flex: none; }
.room-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.room-host { display: flex; align-items: center; gap: 8px; }
.lock-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 8px; background: color-mix(in srgb, var(--text) 8%, transparent); }
.room-enter { color: var(--accent); font-weight: 700; padding: 0 6px; }
.empty-text { padding: 24px 4px; }
.lobby-bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px max(16px, env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--panel-b); display: flex; gap: 8px; align-items: center; justify-content: center; }
.lobby-bar form { display: flex; gap: 8px; align-items: center; width: 100%; max-width: 528px; }
.online2 { padding-bottom: 96px; }
```

- [ ] **Step 4: Fix the background seam** (seen at 780px in `docs/design/impl-screens/screens-online-360-wood.png`): body background is `fixed`; add to `menus.css` `html { background: var(--bg); }`. Verify: scroll the lobby with 6+ rooms (mock `/api/rooms` by `page.route` in a one-off script) — no color step.

- [ ] **Step 5: Verify** — gate shows no `/online` offenders at the three widths; filter test in browser: with the 6-room mock, `Длинные` hides short rooms; code form still navigates to `/r/ABC123`.

- [ ] **Step 6: Commit** `git add apps/web/src/screens/Menus.tsx apps/web/src/screens/menus.css && git commit -m "feat(web): online lobby — filter, parameter chips, bottom code bar"`

---

### Task 5: Waiting room

**Files:** Modify `apps/web/src/screens/Room.tsx` (only the `if (!match) {…}` return, `Room.tsx:111-143` on the polish branch), `menus.css`, spec line 38.

**Interfaces:** Consumes `room: RoomView | null` from `useGame`; `room.settings`, `room.hasPassword`. Must guard `room === null` (first server message not yet arrived).

- [ ] **Step 1: Replace the waiting block**

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
Add `import { Icon } from '../components/icons';`. `.big-code span` tiles (existing styles at `styles.css:629`) are reused.

- [ ] **Step 2: CSS**

```css
.wait2 { max-width: 560px; margin: 0 auto; width: 100%; gap: 12px; }
.code-card { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px 16px; border-radius: 20px; background: var(--bg2); border: 1px solid var(--panel-b); }
.status-pill { font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 14px; background: var(--panel); color: var(--muted); }
.status-pill.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.params { margin: 0; border-radius: 16px; border: 1px solid var(--panel-b); overflow: hidden; }
.params > div { display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--panel-b); }
.params > div:last-child { border-bottom: 0; }
.params dt { color: var(--muted); } .params dd { margin: 0; font-weight: 700; }
.leave { align-self: center; min-height: 44px; }
```

- [ ] **Step 3: Amend the spec** — in `docs/superpowers/specs/2026-11-15-screens-redesign-design.md` line 38 replace «Закрыть комнату» явным текстом with «Выйти» (Worker не умеет закрывать комнату: `worker/src/room.ts` закрывает сокеты только при ошибке/истечении), and in the audit file `docs/superpowers/plans/2026-11-15-screens-redesign-spec-audit.md` §2 mark the open item as resolved with this reference.

- [ ] **Step 4: Verify live** — with `wrangler dev` running: create a room via UI, confirm the waiting screen at 360/768/1440 (code card, two buttons, params match what was chosen, status pill matches the «Публичная» toggle both ways), copy button flips to «Скопировано». Open the room link in a second context: game starts (e2e `online.e2e.cjs` covers it — run it). Then `node e2e/screens.e2e.cjs` → `offenders=0` for **all** routes. Fill `GATES.md` G1 EVIDENCE with the green output.

- [ ] **Step 5: Commit** `git add apps/web/src/screens/Room.tsx apps/web/src/screens/menus.css docs/superpowers/specs/2026-11-15-screens-redesign-design.md docs/superpowers/plans/2026-11-15-screens-redesign-spec-audit.md GATES.md && git commit -m "feat(web): waiting room — code card, share-first, params summary, leave"`

---

### Task 6: Game HUD (phone and desktop)

**Files:**
- Create: `apps/web/src/screens/GameHud.tsx`, `apps/web/src/screens/game-hud.css`
- Modify: `apps/web/src/screens/Game.tsx` (`playerBar` and the `mobile-hud` / `desktop-hud` / `desk-more` blocks, `Game.tsx:~419-460` and `~640-735` on the merged base), imports.

**Interfaces:**
- Produces from `GameHud.tsx`:

```ts
export interface StripProps {
  color: Color; name: string; offline: boolean; mine: boolean; active: boolean;
  pips: number; pipDiff: number;          // pipDiff > 0: this side is ahead by that many pips
  off: number; score: number; cube: ReactNode | null;
  bank: string | null; move: string | null; low: boolean; pieceChip: ReactNode;
  statusText: string;                     // "ваш ход" / "ход соперника" — shown only when active
}
export function PlayerStrip(p: StripProps): JSX.Element;
export interface ActionBarProps {
  canUndo: boolean; undoCountdownMs: number | null; undo: () => void;
  showDone: boolean; canDone: boolean; done: () => void;
  onReact: (emoji: string) => void; emojis: readonly string[];
  onChat: (() => void) | null; chatDot: boolean;
  extra: ReactNode;                       // double button / claim button, passed through
}
export function ActionBar(p: ActionBarProps): JSX.Element;
```
- Consumes in `Game.tsx`: `pipCount(board, c)` (`@nardy/core`), `clockFor(c)`, `fmt`, `act`, `viewer`, `opp`, `statusText` — all already in scope.

- [ ] **Step 1: `PlayerStrip`** — one row: chip, name + «ваш ход» (only when `active`), `pips · off/15 · ahead`, timers. Keep `data-pips` and the `.pmeta` class on the pips element (e2e reads both).

```tsx
export function PlayerStrip(p: StripProps) {
  const T = useT();
  const diff = p.pipDiff > 0 ? `${T.pipsAhead} ${p.pipDiff}` : p.pipDiff === 0 ? T.pipsEven : '';
  return (
    <div className={'strip' + (p.active ? ' active' : '') + (p.mine ? ' mine' : '')}>
      {p.pieceChip}
      <div className="strip-main">
        <div className="strip-name"><b title={p.name}>{p.name}</b>{p.offline && <span className="tag warn">{T.offline}</span>}{p.active && <span className="turn-now">{p.statusText}</span>}</div>
        <div className="pmeta" data-pips={p.mine ? 'me' : 'opp'}>{p.pips} {T.pips} · {p.off}/15{diff && <span className={p.pipDiff > 0 ? ' ahead' : ''}> · {diff}</span>}</div>
      </div>
      <span className="strip-score" title={T.score}>{p.score}</span>
      {p.cube}
      {(p.bank || p.move) && <div className="strip-timers"><span className="bank-time">{p.bank ?? '—'}</span><span className={'move-time' + (p.low ? ' low' : '')}>{p.move ?? '—'}</span></div>}
    </div>
  );
}
```
Note: the existing `.pmeta` text was `"{pips} {T.pips} · {off}/15"`; e2e line 431 compares `.pmeta` text contents between two pages before/after — with the diff suffix the strings differ per player, and e2e only compares each page's own text to itself over time? **Verify in Task 7 by reading line 431 context before trusting this**; if it compares opponent vs own text, keep the diff in a separate `<span>` outside `.pmeta`.

- [ ] **Step 2: `ActionBar`** — fixed row, 48px controls:

```tsx
export function ActionBar(p: ActionBarProps) {
  const T = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="action-bar">
      <div className="react-wrap">
        <button className="round" aria-label={T.reactions} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="smile" /></button>
        {open && <div className="react-pop" role="menu">{p.emojis.map((e) => <button key={e} role="menuitem" onClick={() => { p.onReact(e); setOpen(false); }} aria-label={e}>{e}</button>)}</div>}
      </div>
      {p.onChat && <button className="round" aria-label={T.chat} onClick={p.onChat}><Icon name="chat" />{p.chatDot && <i className="dot" />}</button>}
      <button className={'btn' + (p.undoCountdownMs !== null ? ' primary undo-send' : '')} disabled={!p.canUndo} onClick={p.undo}>
        <Icon name="undo" size={16} /> {T.undo}
        {p.undoCountdownMs !== null && <i className="countdown" style={{ ['--ms' as string]: `${p.undoCountdownMs}ms` }} />}
      </button>
      {p.showDone && <button className="btn primary" disabled={!p.canDone} onClick={p.done}><Icon name="check" size={16} /> {T.done}</button>}
      {p.extra}
    </div>
  );
}
```
Button text is now `Отменить` / `Готово` with `aria-hidden` icons, so accessible names change from `↶ Отменить` / `✓ Готово` — e2e updated in Task 7. Emoji reaction glyphs inside the popover remain emoji **as content** (they are the sent message, not a UI icon).

- [ ] **Step 3: Compose in `Game.tsx`.**
  1. Replace `playerBar`'s `hud` branch with `PlayerStrip` (build `StripProps` from the same values the old code computed: `bankLeft`, `moveLeft`, `pieceLabel`, `active`; `pipDiff = pipCount(board, other) - pipCount(board, c)` where `other` is the opposite color).
  2. Phone (`compact`): render opponent strip **above** `.board-wrap` (after `<header className="game-top">`), own strip + `ActionBar` **below** wrapped in `<div className="mobile-hud">` (class kept: e2e measures it). Remove the centered emoji row (`.quick-reactions`) and `.status` text from the middle block; `statusText` now lives in the active strip.
  3. Desktop (`wide`): wrap board in `.desk-grid` (board left, `.desk-col` right). `.desk-col` order: meta line (`T.matchLength N · variant`), score block (names + big `m.score[0] : m.score[1]`), opponent strip, chat panel (existing `<aside className="chat">`, unchanged component, now always open on `wide` online), own strip, `ActionBar`. «Сдаться»: move into the `⋯` menu button (`aria-label={T.moreActions}`, popover with settings + resign; `setConfirmResign(true)` unchanged), delete the standalone `.resign` button and the `desk-more` wrapper.
  3a. Local mode (`g.mode === 'local'`) has no chat: `.desk-col` omits the chat panel and the strips still render.
  4. Do **not** touch: board props, `Board.tsx`, move/submit/undo logic, timers, cube modal, result modal, `confirmResign` dialog, settings dialog.

- [ ] **Step 4: CSS** `game-hud.css` (import in `Game.tsx`); rules per class above, tokens only:

```css
.strip { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 14px; background: var(--panel); border: 1px solid var(--panel-b); min-height: 56px; }
.strip.active { background: var(--bg2); border: 1.5px solid var(--accent); }
.strip-main { flex: 1; min-width: 0; }
.strip-name { display: flex; align-items: baseline; gap: 8px; }
.turn-now { font-size: 13px; font-weight: 700; color: var(--accent); }
.pmeta .ahead { color: var(--ok); font-weight: 700; }
.strip-timers { display: flex; flex-direction: column; gap: 2px; font-size: 12px; font-variant-numeric: tabular-nums; }
.action-bar { display: flex; align-items: center; gap: 8px; }
.action-bar .btn { flex: 1; min-height: 48px; }
.action-bar .round { width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--panel-b); background: var(--panel); color: var(--text); display: grid; place-items: center; position: relative; }
.react-wrap { position: relative; }
.react-pop { position: absolute; bottom: 56px; left: 0; display: flex; gap: 4px; padding: 6px; background: var(--bg); border: 1px solid var(--panel-b); border-radius: 14px; box-shadow: 0 6px 30px #0008; z-index: 10; }
.react-pop button { width: 44px; height: 44px; border: 0; background: transparent; font-size: 22px; }
.desk-grid { display: flex; gap: 40px; align-items: flex-start; justify-content: center; }
.desk-col { width: 340px; display: flex; flex-direction: column; gap: 14px; min-height: calc(100vh - 48px); }
.desk-col .chat { flex: 1; min-height: 0; }
.desk-score { text-align: center; font-size: 40px; font-weight: 800; font-variant-numeric: tabular-nums; }
```
Existing `.mobile-hud` grid rule (`styles.css:1252`, 3 columns) conflicts: override in `game-hud.css` with `.mobile-hud { display: flex; flex-direction: column; gap: 8px; }` (loaded after `styles.css`, same specificity, later wins — confirm in the browser computed style).

- [ ] **Step 5: Live verification** (this is the gate for the whole task; no test framework exists for the web app, so measure):
  - 360×780, `/play?mode=ai&variant=long&level=amateur&len=3`: measure and print `board.bottom → ownStrip.top` gap (target ≤ 16px), `strip.height` ≥ 56, every `button` ≥ 44px, `document.documentElement.scrollWidth <= 360`, console errors = 0. Gate output must name each violation, e.g. `360: gap board→own strip = 108px (max 16)`.
  - Active turn: own strip has `.active` and text «ваш ход»; after the AI moves, opponent strip has it and own does not.
  - Pip diff: start position → both `pipsEven`; after one move, exactly one strip shows `впереди на N` with `N = |pipCount(own) − pipCount(opp)|` (read both `.pmeta` numbers and compute in the script).
  - Select a checker: `[data-hint="selected"]` count = 1 and `[data-hint="target"]` > 0 (green selection from `fe762f2` unaffected). Undo button disabled before any move, enabled after, board returns to the pre-move pip count after Undo.
  - 1440×900 online (two contexts as in `e2e/online.e2e.cjs`): `.desk-col` height ≥ viewport−48 (no 550px hole: gap between opponent strip bottom and chat top < 24px, chat bottom to own strip < 24px); Resign reachable only via `⋯`, and the confirm dialog still appears.
  - Themes: repeat the 360 check with `localStorage nardy.settings.theme` = `minimal`, `malachite`.
  - A selector-less negative check (gate must be able to go red): run the 360 measurement against the pre-task commit; it must print the 100px+ gap. Save both outputs in `GATES.md` G2 EVIDENCE.

- [ ] **Step 6: Commit** `git add apps/web/src/screens/GameHud.tsx apps/web/src/screens/game-hud.css apps/web/src/screens/Game.tsx && git commit -m "feat(web): game HUD — player strips, action bar, reactions popover, desktop column"`

---

### Task 7: e2e selector update and final verification

**Files:** Modify `e2e/online.e2e.cjs` (selectors only).

- [ ] **Step 1: List every reader** (do not trust this plan's line numbers after Task 6):

```bash
grep -n "Отменить\|Готово\|Сдаться\|pmeta\|data-pips\|mobile-hud\|quick-reactions\|\.status\|emoji-bar\|desk-more\|\.resign" e2e/online.e2e.cjs
```
- [ ] **Step 2: Update** `{name:'↶ Отменить',exact:true}` → `{name:'Отменить',exact:true}` and `✓ Готово` → `Готово`; replace any `.resign`/`Сдаться` click with: click `button[aria-label="Ещё"]` then the resign item (or keep the compact path if the `⋯` popover keeps the same accessible name — read the file, do not guess); replace `.emoji-bar`/`.quick-reactions` clicks with: click `button[aria-label="Реакции"]` then a `[role="menuitem"]`. At line 431 (`.pmeta` compared across contexts) read the surrounding code first and apply the fallback in Task 6 Step 1 if it compares across players.
- [ ] **Step 3: Full verification, each exit code read from the script itself**

```bash
npm run typecheck; echo tc=$?
npm test; echo test=$?
npm run build; echo build=$?
(npm run dev:worker &) ; sleep 6
NARDY_URL=http://127.0.0.1:8787 NODE_PATH=... node e2e/online.e2e.cjs; echo e2e=$?
NARDY_URL=http://127.0.0.1:8787 NODE_PATH=... node e2e/screens.e2e.cjs; echo gate=$?
```
Expected: all `=0`. Any non-zero: stop, report the first failing line, do not edit the gate.
- [ ] **Step 4:** Screenshots at 360/768/1440 for the 5 screens × 3 themes into `docs/design/impl-screens/redesign-<screen>-<w>-<theme>.png`; compare against the canvas frames and name every difference («at 360: waiting room params card 12px lower than canvas»).
- [ ] **Step 5: Commit** `git add e2e/online.e2e.cjs docs/design/impl-screens/redesign-*.png GATES.md && git commit -m "test: e2e selectors for redesigned HUD; redesign screenshots"`
- [ ] **Step 6: Review rounds** (CLAUDE.md pipeline): flagship reviewers under the orchestrator until a round returns no P0–P2; then full diff to `codex exec -m <GPT-6-Astra id> ... < /dev/null` for the final pass. Before any dispatch: stdin closed, echo-probe of the spec path, `node_modules` present in the review tree.

---

## Self-review against the spec

| Spec section | Task |
|---|---|
| База — merge polish branches | 0 |
| Пункт 1 Главная | 2 |
| Пункт 1 Игра с ботом / вдвоём | 3 |
| Пункт 1 Онлайн-лобби (+ шов фона) | 4 |
| Пункт 1 Ожидание (amended: «Выйти») | 5 |
| Пункт 1 Десктоп 768/1440 | 2 (`.home2`), 3 (`.setup2`, bottom bar max-width), 4, 5 (`max-width:560px`); checked by gate at 768/1440 |
| Пункт 2 телефон 360: полоски, чей ход, пипсы, панель действий, реакции | 6 |
| Пункт 2 десктоп 1440: колонка, счёт, «Сдаться» в «⋯», вкладки «Чат» | 6 (chat is always-open panel, not tabs: the log tab is out of scope, a single tab would be an empty abstraction) |
| Читатели общих полей (i18n, `.pmeta`, e2e, `.link/.btn/.seg`) | 1, 6, 7 |
| Проверка (живой прогон, 3 ширины, 3 темы, состояния) | 5, 6, 7 |

**Known gaps, stated:**
- The spec mentions «пустое, ошибка, длинное имя» states; the gate covers overflow with the default name only. Task 7 Step 4 adds a 20-char name run on `/ai` and `/online` at 360 — add it to the screenshot loop.
- Local-mode (`two players, one device`) game HUD is verified only on the phone width; desktop local mode is checked in Task 6 Step 5 item «3a» by a single manual pass.
- Web unit tests do not exist (`npm test` runs core only); pip diff is verified by the live measurement in Task 6, not a unit test.
- `Logo.tsx` rendered size is unknown until read — Task 2 Step 2 says to read it first.
