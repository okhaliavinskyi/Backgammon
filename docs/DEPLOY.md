# Деплой в Cloudflare

Игра — это один Cloudflare Worker. Он раздаёт статику клиента и обслуживает API и WebSocket'ы через Durable Objects. Всё укладывается в бесплатный тариф Workers: Durable Objects на SQLite доступны на Free-плане.

## Однократная настройка (≈5 минут)

1. **Account ID.** Cloudflare Dashboard → *Workers & Pages* → справа *Account ID* → скопировать.
2. **API Token.** Dashboard → *My Profile* → *API Tokens* → *Create Token* → шаблон **«Edit Cloudflare Workers»** → *Account Resources*: свой аккаунт → *Continue* → *Create Token* → скопировать.
3. **Поддомен workers.dev.** *Workers & Pages* → *Overview*. Если поддомен ещё не выбран, Cloudflare предложит его создать (например, `oleg.workers.dev`).
4. **Секреты в GitHub.** Репозиторий → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*:
   - `CLOUDFLARE_API_TOKEN` — токен из шага 2;
   - `CLOUDFLARE_ACCOUNT_ID` — ID из шага 1.
5. Запушить в `main` (или *Actions → Deploy to Cloudflare → Run workflow*).

Workflow `deploy.yml` прогоняет тесты, собирает клиент, выполняет `wrangler deploy` и проверяет `/api/health`. Адрес игры (`https://nardy.<поддомен>.workers.dev`) появится в *Summary* запуска.

Пока секретов нет, workflow выводит предупреждение и завершается без ошибки.

## Свой домен (необязательно)
*Workers & Pages* → `nardy` → *Settings* → *Domains & Routes* → *Add* → *Custom domain*.

## Автоматическая настройка одним скриптом
`scripts/go-live.sh` проходит все шаги сам: проверки, первый деплой, секреты, ветку `main`, ожидание CI и e2e против прода.

## Ручной деплой с компьютера
```bash
npm ci
npx wrangler login        # один раз
npm run deploy            # сборка клиента + wrangler deploy
```

## Локальная разработка
```bash
npm ci
npm run build                     # клиент → apps/web/dist
npm run dev:worker                # http://127.0.0.1:8787 — игра целиком, с Durable Objects
# или для быстрой правки UI с hot-reload:
npm run dev:web                   # http://localhost:5173, /api проксируется на :8787
```

## Тесты
```bash
npm test                                                   # правила, ИИ, fuzz «ИИ против ИИ»
npm run typecheck
(cd worker && NARDY_URL=http://127.0.0.1:8787 npm run test:integration)   # при запущенном dev:worker
node e2e/online.e2e.cjs                                    # браузерный e2e (нужен playwright)
```


## OnlineBoard mounted release

Production uses the `onlineboard` catalog Worker from the separate
[GamePortal repository](https://github.com/okhaliavinskyi/GamePortal) at the root.
It forwards `/backgammon/*` unchanged through its NARDY service binding. This
repository builds both standalone and mounted clients and deploys only `nardy`,
which owns game assets, APIs and Durable Objects. The GamePortal workflow is
manual; deploy nardy before the portal when changing their shared contract.

The old `apps/portal` source is retained temporarily for migration checks, but its
Wrangler configuration and deployment steps were removed in PR #2. Do not
recreate them or publish the old portal: that would overwrite GamePortal.
Email settings and the origin/path allowlists live in worker/wrangler.toml.
See docs/EMAIL-ACCOUNTS.md for guest-progress continuity and local auth checks.
