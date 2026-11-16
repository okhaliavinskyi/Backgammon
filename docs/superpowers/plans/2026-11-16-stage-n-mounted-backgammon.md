# План: этап N — `nardy` отдаёт `/backgammon/*`

Спека: `docs/superpowers/specs/2026-11-16-stage-n-mounted-backgammon-design.md`. Ветка
`claude/stage-n-mount-backgammon-5c292f`. Код — только после sign-off. Номера строк сверять в
дереве, не по памяти. Код ниже — **черновик**: ревью проверяет исполнением.

## Карта батчей

Оркестратор — Opus (эта сессия): держит карту, читает дифы, ведёт проверки. Деньги/деплой: нет.

### Батч 1 — ядро (оркестратор, сам)
Владеет: `apps/web/package.json`, `package.json` (корень, только `scripts.build`),
`worker/wrangler.toml`, `worker/src/index.ts`.
- `apps/web/package.json`: `"build:mounted": "vite build --base=/backgammon/ --outDir dist/backgammon --emptyOutDir false"`.
- Корень `build`: `npm run build -w @nardy/web && npm run build:mounted -w @nardy/web`.
- `worker/wrangler.toml`: `run_worker_first = ["/api/*", "/backgammon", "/backgammon/*"]`.
- `worker/src/index.ts` (черновик логики, до `if (!path.startsWith('/api/'))`):
  ```ts
  const MOUNT = '/backgammon';
  // SPA routes of the mounted client (moved verbatim from apps/portal/src/index.ts).
  const MOUNTED_SPA = /^\/backgammon\/(?:|online|create|ai|local|settings|play|profile|ranked|auth|privacy|terms|legal|r\/[A-Za-z0-9]{6})$/;
  ...
  if (path === MOUNT) { url.pathname += '/'; return Response.redirect(url.toString(), 308); }
  if (path.startsWith(MOUNT + '/api/')) { url.pathname = path.slice(MOUNT.length); return this.fetch(new Request(url, request), env); }
  if (path.startsWith(MOUNT + '/')) return mounted(request, url, env);
  ```
  `mounted`: не GET/HEAD → 405; SPA-regex → `ASSETS.fetch` на `/backgammon/`; иначе `ASSETS.fetch(request)`;
  **механизм 404:** ответ `text/html` на путь, кроме `/backgammon/`, → 404 с HTML портала побайтно. Комментарий в коде называет механизм (SPA-fallback отдаёт 200 html на отсутствующий ассет).
  Рекурсия через `this.fetch` и литерал-копия — на проверку: `export default { fetch }` как object, `this` может не быть → вынести функцию `handle`.
Приёмка батча: `npm run typecheck`, `npm test`, `npm run build && ls apps/web/dist apps/web/dist/backgammon`, чтение дифа.

### Батч 2 — тесты (два агента параллельно; Sonnet)
Читают результат батча 1; пишут **разные** файлы, друг друга не импортируют.
- **2a** владеет `worker/test/mounted.test.ts` (vitest против `NARDY_URL`, как `integration.test.ts`): `/backgammon/api/health` и `/api/health` — одинаковые статус и `content-type` (200 JSON); комната `POST /backgammon/api/rooms` → 201, WebSocket `/backgammon/api/rooms/<id>/ws` подключается; `/backgammon` → 308 `Location` оканчивается `/backgammon/` (redirect: 'manual'); `/backgammon/assets/missing.js`, `/backgammon/nope`, `/backgammon/online/x` → 404; `/backgammon/ai`, `/backgammon/online`, `/backgammon/r/ABC123`, `/backgammon/` → 200 и тело ссылается на `/backgammon/assets/` (а не `/assets/`); `POST /backgammon/online` → 405; `/backgammon/assets/<реальный хеш из index.html>` → 200 JS; **автономный путь не меняется:** `/ai`, `/`, `/api/health` как на `HEAD` (200, корневой клиент). Агент **ничего не запускает** — запуск оркестратором.
- **2b** владеет `e2e/mounted.e2e.cjs`: заготовка GamePortal `docs/handoff/backgammon-mounted.e2e.cjs`
  (читать с диска `~/Projects/GamePortal/…`, только чтение), адаптация под `playwright` этого дерева
  (проверить `channel: 'chrome'` против `GATES.md`), ширины 360/768/1440, плюс проверка отсутствия CSP-нарушений
  в консоли и `console.error` (список названий нарушений в сообщении, не «пусто»), `.portal-back` ведёт на `/`.
  Агент ничего не запускает.

### Батч 3 — заготовка PR окна (отдельная ветка, не сливается; Sonnet)
Ветка `claude/window-pr-backgammon` от **`main` @ `4bf9eba`** (не от ветки N: PR окна должен сливаться независимо).
Владеет: `.github/workflows/deploy.yml`, `package.json` (только `scripts.deploy:portal`), `apps/portal/wrangler.jsonc`
(удаление), `apps/portal/README.md`. Содержимое — `GamePortal/docs/handoff/backgammon-window-pr.md`. Файл `deploy.yml` в ветке N не меняется.
PR **не открывается** без слова владельца (вывод: подготовленная ветка и текст PR в `docs/`); в N-ветке — только ссылка на неё в отчёте. Проверка по списку из заготовки (`grep`).

### Батч 4 — ворота и живая проверка (оркестратор)
Владеет: `GATES.md`. Порядок: красный на базе → зелёный (§Ворота).

## Распределение моделей
Батч 1 — Opus (оркестратор). 2a, 2b, 3 — Sonnet (механика по готовому коду плана, с проверкой дифа). Ревью — один свежий Opus и один Codex-флагман (см. §Ревью); финал — codex GPT-6-Astra-Medium по правилам передачи (stdin закрыт, эхо-проба, `node_modules` в дереве).

## Ворота (строки для `GATES.md`)
Для каждой: красный на `HEAD` до батча 1 (или с вынутой защитой), код возврата — **у скрипта**, не у `| tail`.

- **N1 сборка.** CHECK: `npm run build; echo rc=$?; ls apps/web/dist apps/web/dist/backgammon`. EXPECT: rc=0; в `dist/backgammon/index.html` нет подстроки `"/assets/` (все ссылки `/backgammon/assets/`), в `dist/index.html` нет `/backgammon/`. Красное: на `HEAD` `dist/backgammon` отсутствует («found 0 files, expected index.html»).
- **N2 статусы.** CHECK: `NARDY_URL=http://127.0.0.1:<port> npx vitest run worker/test/mounted.test.ts`. Красное на `HEAD`: `/backgammon/api/health` — html вместо JSON. Красное с вынутым правилом 404 (закомментировать замену html→404): `missing.js` 200. Порог не нужен — сравнения точные.
- **N3 e2e на 360/768/1440.** CHECK: `NARDY_URL=http://127.0.0.1:<port> node e2e/mounted.e2e.cjs; echo rc=$?`. Красное: на `HEAD` падает на `/backgammon/ai` (корневой клиент, нет `/backgammon/` в `location`).
- **N4 CSP/SW/офлайн.** Внутри N3: `navigator.serviceWorker.ready.scope === '/backgammon/'`, перезагрузка офлайн, `manifest.scope` → `/backgammon/`, консоль без нарушений CSP; ответ `/backgammon/` содержит `content-security-policy`. Красное: подмена `_headers` строкой `script-src 'none'` — e2e обязан назвать нарушение.
- **N5 auth.** CHECK: wrangler dev с `EMAIL_FROM`, `AUTH_ORIGINS`/`AUTH_MOUNTED_ORIGINS` = локальный origin, лог в `NARDY_MAIL_LOG`; `NARDY_URL=<origin>/backgammon npx vitest run --root worker test/auth.test.ts`. Ссылка в письме — `<origin>/backgammon/auth#…`. Красное: на `HEAD` `/backgammon/api/auth/*` — html, тест падает.
- **N6 аддитивность.** Слепок ответов `HEAD` и ветки на путях `www`: `/`, `/ai`, `/api/health`, `/assets/missing.js`, `/manifest.webmanifest`, `/sw.js` (статус, content-type, sha256 тела, наличие CSP). EXPECT: равны, за вычетом хеша `index.html` (двойной билд не меняет `index.html` базовой сборки — сверить sha ненулевое равенство; различие названо поимённо). Красное: временная правка `www`-пути.
- **N7 старый портал.** `npm run build:portal` (старый) собирается: exit 0; `apps/portal/dist/backgammon/index.html` ссылается на `/backgammon/assets/`. Красное: изменить `build` в `apps/web` на двойной — `build:portal` ломается (доказывает, почему `build:mounted` отдельный).
- **N8 живой браузер.** Прогон N3 на трёх ширинах плюс скриншоты 360/768/1440 главного экрана и `/backgammon/play?mode=ai&level=beginner` в `docs/design/impl-screens/stage-n-*.png`; консоль чиста.

## Приёмка до окна (после слова владельца о деплое `nardy`, вне этого плана)
`nardy.o-khaliavinskyi.workers.dev/backgammon/` отдаёт клиент, `/backgammon/api/health` JSON, `/backgammon/assets/missing.js` 404, `/backgammon/ai` клиент, `/backgammon` 308; `www` и старый портал как раньше. Деплой этой ветки — только по слову владельца.

## Ревью плана (не более двух раундов, цель — ноль P0–P2)
Раунд 1: Opus свежим контекстом + Codex-флагман, оба с правилами «не по памяти, проверять исполнением, не проверено: причина — допустимый ответ». Раунд 2 — только если раунд 1 принёс P0–P2. Несогласие называется в плане отклонённым.

## Отклонённые находки / решения
(заполняется по ревью)
