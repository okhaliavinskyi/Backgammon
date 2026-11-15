# CLAUDE.md — nardy (нарды онлайн)

Правило, дата, авария, цена. Ни одного правила «на всякий случай».

## Что это за проект

Нарды (длинные и короткие) в браузере: движок `packages/core`, клиент React 19 + Vite
`apps/web`, один Cloudflare Worker `worker` (статика + API + WebSocket через Durable Objects).
Инвариант: правила игры живут только в `packages/core`; визуальные правки его не трогают.

## Параллельные сессии, ветки и деплой

Работа идёт в фича-ветках, интеграция — merge в `main` через `--no-ff`.
Пуш в main: `.github/workflows/deploy.yml` катит прод (`wrangler deploy` + `/api/health`).
Пуш в main = выкатка, только по слову владельца.
Смерженную ветку не продолжать; удалять `-d`.

## Канонические команды

- установка: `npm ci`
- проверка типов: `npm run typecheck`
- тесты: `npm test`
- сборка: `npm run build`
- локальный воркер: `npm run dev:worker` (после build; один Wrangler за раз — SQLITE_BUSY)
- интеграция: `NARDY_URL=http://127.0.0.1:8787 npx vitest run worker/test/integration.test.ts`
- деплой: push в `main` (CI) или `npm run deploy`

## Инварианты — читать до того, как писать код

<Пусто, пока нечем заполнить.>

## Сделано — это прогнано по живому

Изменение, которое увидит игрок, не считается сделанным, пока его не прогнали в
браузере против `wrangler dev` (e2e: `node e2e/online.e2e.cjs`, режимы — в
`docs/superpowers/plans/2026-11-15-claude-handover.md`).

## Ворота

Приёмка живёт в `GATES.md`: `OWNS` / `CHECK` / `EXPECT` / `EVIDENCE`.

Ворота, удовлетворяемые удалением фичи, — не ворота; порог мерить до выбора; код возврата читать у скрипта.

## Аварии

<Пока пусто.>
