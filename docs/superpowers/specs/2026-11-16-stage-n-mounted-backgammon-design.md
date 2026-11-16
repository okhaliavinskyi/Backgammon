# Спека: этап N — `nardy` сам отдаёт `/backgammon/*`

Дата: 2026-11-16. Ветка `claude/stage-n-mount-backgammon-5c292f` от `main` @ `4bf9eba`.
Источник контракта: GamePortal `docs/2026-11-16-portal-extraction-spec.md` §6,
`docs/handoff/backgammon-nardy-contract.md`. Это спека работы в репозитории нард;
GamePortal только читался.

## 1. Frame — сегодняшний поток

Игрок открывает `https://onlineboard.fun/backgammon/…`:

1. Route `onlineboard.fun/*` → Worker `onlineboard` (старый портал, `apps/portal/src/index.ts`).
2. Статику клиента (собран `build.mjs` с `--base=/backgammon/` в `apps/portal/dist/backgammon`)
   портал отдаёт сам из своего `ASSETS` с `html_handling: none`, `not_found_handling: none`.
   SPA-маршруты (regex в портале) переписываются на `/backgammon/index.html`.
3. `/backgammon/api/*` → binding `NARDY`, префикс `/backgammon` отрезается, host и `Origin`
   сохраняются. WebSocket идёт нетронутым.
4. `www.onlineboard.fun` и `nardy.o-khaliavinskyi.workers.dev` — сам `nardy`, автономный клиент
   (`base=/`, `dist/` из `apps/web`), `/api/*`, заголовки CSP/XFO из `apps/web/public/_headers`.

Выкатка: каждый push в `main` → `deploy.yml` → `nardy`, затем старый портал.

| | Сегодня | После N (до окна) | После окна |
|---|---|---|---|
| `onlineboard.fun/backgammon/…` | старый портал, сам | **без изменений** (старый портал) | портал → binding `NARDY` → `nardy` |
| `www`, workers.dev, `/` | автономный клиент | без изменений | без изменений |
| `nardy…workers.dev/backgammon/…` | SPA-fallback отдаёт **автономный** клиент (проба §3.1) | клиент `base=/backgammon/`, API, 404/308 | то же |
| push в `main` | `nardy` + портал | `nardy` + портал (окно ещё не слито) | только `nardy` |

**Что ломает для того, кто выучил старый поток.** Игрок: ничего видимого до окна; после окна
`/backgammon/*` получает CSP/XFO (допустимо, §4.5) и `/backgammon/index.html` отвечает 307
вместо 200 (нигде не ссылаются). Разработчик нард: `npm run build` собирает два клиента
(+0.1 с); `worker/wrangler.toml` получает `run_worker_first` на `/backgammon*` — каждый
запрос статики под префиксом идёт через Worker (портал так же делает сегодня, `run_worker_first: true`).
Старый портал не затронут: он строит клиент командой `npm run build -w @nardy/web -- --base=/backgammon/ --outDir …`.
Скрипт `build` в `apps/web` **не меняется**: двойная сборка живёт в новом `build:mounted`. Причина — не поломка
(R1 прогнал: npm дописывает аргументы к последней команде, последний `--outDir` побеждает, сборка портала
остаётся корректной), а побочный эффект: лишний прогон базовой сборки и запись в `apps/web/dist` при каждой сборке портала.

## 2. Объём

В объёме (аддитивно): двойная сборка, префикс `/backgammon/api/*`, `/backgammon` → 308, SPA-regex
и 404 внутри `nardy`, 405 для не-GET под префиксом, тесты и e2e, живая проверка auth-ссылок,
заготовка PR окна (отдельная ветка, не сливается).

Не в объёме: деплой `nardy`, push в `main`, любые изменения Worker `onlineboard`, удаление
`apps/portal`, правки `docs/DEPLOY.md`/`EMAIL-ACCOUNTS.md` (этапы окна и D), дизайн-шаг
(экранов нет: тот же клиент; тело 404 побайтно то же, §4.3).

## 3. Пробы (исполнением, wrangler 4.162.0 `wrangler dev`, build apps/web, два клиента в одном `dist`)

Конфиг пробы: `not_found_handling = "single-page-application"`, Worker, который зовёт
`env.ASSETS.fetch(request)` и ставит `x-probe-worker`. Локальный miniflare, не прод;
повтор на прод-подобной среде — в приёмке (§6, ворота N5).

1. **SPA-fallback.** `/backgammon/assets/missing.js` → **200 text/html**; `/backgammon/nope` и
   `/backgammon/ai` → 200 и **корневой** `index.html` (`/assets/index-…js`, `base=/`), а не
   клиент `/backgammon/` (`/backgammon/assets/…`). Без кода `/backgammon/ai` отдаёт не тот клиент.
2. **Глоб.** `run_worker_first = ["/backgammon/*"]` **не** покрывает `/backgammon`: ответ 307
   отдаёт ассет-слой, Worker не вызван. С `["/backgammon", "/backgammon/*"]` Worker видит оба.
3. **`html_handling` по умолчанию.** `/backgammon/index.html` → 307 `/backgammon/`; `/backgammon`
   без Worker → 307 (нужен 308). SPA-маршруты отдаются как `/backgammon/` (200, верный клиент).
4. **Заголовки.** `public/_headers` (`/*`, корневой файл `dist/_headers`) применяется и к
   `/backgammon/*` через `ASSETS.fetch`: CSP, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy
   на `/backgammon/` (проба 8801). Копия `dist/backgammon/_headers` не работает (только корень) и безвредна.
5. **Двойная сборка.** `vite build` + `vite build --base=/backgammon/ --outDir dist/backgammon
   --emptyOutDir false` дают `dist/{index.html,assets}` и `dist/backgammon/{index.html,assets}`;
   `base=/` ссылается на `/assets/…`, второй — на `/backgammon/assets/…`.

## 4. Решения

### 4.1 Сборка
`apps/web/package.json`: новый скрипт `"build:mounted": "vite build --base=/backgammon/ --outDir dist/backgammon --emptyOutDir false"`.
Корневой `build`: `npm run build -w @nardy/web && npm run build:mounted -w @nardy/web`. Порядок
важен: первая сборка чистит `dist`. `build` в `apps/web` не трогаем (читатель — `apps/portal/build.mjs`).
`dev:web` и vite `server.proxy` не затрагиваются.

### 4.2 API с префиксом
`worker/src/index.ts`, начало `fetch`: путь, начинающийся с `/backgammon/api/`, переписывается на
`/api/…` (`new Request(url, request)`, host и `Origin` сохраняются, WebSocket-запрос — как сегодня в портале),
дальше прежний обработчик. Неотрезанный `/api/*` остаётся навсегда (нужен `www`, workers.dev).

### 4.3 Статика под префиксом (механизм 404 назван в коде)
- `/backgammon` → `Response.redirect(url with '/' appended, 308)`, query сохраняется (как портал).
- Не GET/HEAD под `/backgammon/` и не API → 405 `Method not allowed`, `Allow: GET, HEAD` (как портал).
- SPA-regex (дословно из портала: `^/backgammon/(?:|online|create|ai|local|settings|play|profile|ranked|auth|privacy|terms|legal|r/[A-Za-z0-9]{6})$`)
  → `ASSETS.fetch` с `pathname = '/backgammon/'`.
- Всё прочее → `ASSETS.fetch(request)`. **Механизм 404:** при `not_found_handling = single-page-application`
  отсутствующий ассет возвращается как 200 `text/html` (проба 1); поэтому ответ `text/html`
  на любой путь кроме `/backgammon/` заменяется на 404 (реальных html-ассетов под префиксом нет).
  Редирект 307 `index.html` пропускается как есть. `html_handling: none` **не** берём
  (меняет `www`/workers.dev).
- Тело 404 — **побайтно HTML портала** (`Страница не найдена · OnlineBoard`, ссылка `/`). Через
  портал игрок получает тот же текст; на workers.dev/`www` ссылка `/` ведёт на автономный клиент.
- 405 — тот же текст, что у портала.

### 4.4 `worker/wrangler.toml`
`run_worker_first = ["/api/*", "/backgammon", "/backgammon/*"]`. Custom domain `onlineboard.fun`
в `routes` — **остаётся** (контракт п.7: страховка при потере route апекса; «снять» закрыто до чтения DNS-зоны Г0).

### 4.5 Допустимые отличия (называются в приёмке)
- CSP/X-Frame-Options/Referrer-Policy/nosniff/Permissions-Policy на `/backgammon/*` (портал их не
  отдаёт; `nardy` — да). Безопасность: клиент собран под CSP на `www`; проверяется браузером
  (SW, manifest, офлайн, 0 CSP-нарушений в консоли) на 360/768/1440 — ворота N4. Портал не
  встраивает нарды в iframe (§2.2 GamePortal), `frame-ancestors 'none'` ему не мешает.
- `/backgammon/index.html`: 200 → 307 `/backgammon/`.
- Тело `/backgammon/api/health` — сравнивается статус и `content-type`.
- Auth-письмо с `nardy…workers.dev/backgammon/`: `AUTH_MOUNTED_ORIGINS` не содержит этот origin,
  ссылка ведёт на `…workers.dev/auth` (автономный клиент, он существует). Через `onlineboard.fun`
  — `/backgammon/auth`. Кода auth не меняем (контракт п.5).
- Неизвестный путь под `/backgammon/` на `www`/workers.dev: SPA-200 → 404 (названо в контракте).
- `www/backgammon/` и `workers.dev/backgammon/` теперь существуют; ссылок на них нет. Если зайти туда напрямую,
  корневой service worker (scope `/`) положит HTML `/backgammon/` в свой кэш под ключ `/` (R1 воспроизвёл в браузере:
  офлайн `www/` потом отдаёт смонтированный клиент). Достижимо только прямым заходом; принимается, лечится
  заходом на `www/` онлайн (сеть-первой). Исправлять SW не берём (кода SW в объёме нет).
- `/backgammon//` → 307 `/backgammon/` (у портала 404); `/backgammon/_headers` → 200 (у портала так же: `build.mjs` кладёт тот же файл).

### 4.6 Читатели (по именам)
`worker/wrangler.toml` (`assets`, `run_worker_first`), `worker/src/index.ts` (маршрутизация; `auth.ts:95`
уже содержит литерал `/backgammon` — не меняется), `apps/web` (`BASE_URL`, `gamePath`, `sw.js`,
`manifest`, `main.tsx` регистрация SW — собраны с base, правок нет), root `package.json` (`build`),
`apps/web/package.json` (+`build:mounted`), `.github/workflows/deploy.yml` (`npm run build` — без правок),
`apps/portal/build.mjs` (вызывает `build -w @nardy/web` — не затронут), `e2e/portal*.e2e.cjs` (против старого
портала — не затронуты), `worker/test/*` (пакетный `vitest`; новый файл добавляется), `GATES.md`.

### 4.7 Что решает владелец (выносится на sign-off)
**Q1. Двойная сборка или одна.** Рекомендация — две (`base=/` и `base=/backgammon/`): `www` и
workers.dev не меняются, откат — убрать один скрипт. Упрощение «одна сборка `base=/backgammon/`»
сломало бы `www` (клиент ждёт `/backgammon/assets/…`) без редиректа `/` → `/backgammon/`; редирект
меняет адрес для гостей `www` (cookie профиля host-only — сохраняются, но SW со scope `/` остаётся
в браузерах и перехватывает навигацию). Цена двух сборок — +0,1 с сборки и +≈0,6 МБ `dist` (измерено: 1,1 МБ всего, 584 КБ под `backgammon/`).
Опционально после окна, отдельным решением.

## 5. Не проверено (честно)
- Прод Cloudflare (не miniflare): поведение `run_worker_first` и 404 при вызове через service binding
  портала — проверяется в приёмке до окна на `nardy…workers.dev` после деплоя (деплой — отдельное слово
  владельца) и на этапе B′ GamePortal.
- Восстановление routes откатом и DNS апекса — вне N.
- Механизм доставки письма в проде — вне N; проверяется локальный симулятор `auth.test.ts`.

## 6. Ворота (GATES.md, раздел N)
N1 сборка: `ls dist dist/backgammon` + grep ссылок; N2 интеграционные статусы
(`worker/test/mounted.test.ts` против wrangler dev); N3 e2e `mounted.e2e.cjs` на 360/768/1440;
N4 CSP/SW/manifest/офлайн под заголовками; N5 auth.test.ts с `NARDY_URL=…/backgammon`;
N6 аддитивность: `www`-пути (`/`, `/api/health`, `/ai`, `/assets/missing.js`) побайтно как на `HEAD`.
Каждое доказывается красным на базе `4bf9eba` (или с вынутой защитой). Подробно — план.
