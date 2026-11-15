# Промпт для новой задачи имплементации (Claude Code / Codex)

```text
Продолжи проект нард в /Users/oleksandrkhaliavinskyi/Projects/Backgammon.
Общаемся по-русски. Это задача ИМПЛЕМЕНТАЦИИ подготовленного редизайна, не нового
планирования. Сначала прочитай CLAUDE.md, корневой handover.md и актуальные AGENTS.md,
затем целиком:
- docs/superpowers/plans/2026-11-15-screens-redesign.md (нужна v3 после round 2);
- docs/superpowers/plans/2026-11-16-screens-redesign-review-r2.md;
- docs/superpowers/specs/2026-11-15-screens-redesign-design.md.

Проверь git status/log/branch. Подготовка была на docs/screens-redesign-spec,
исходный HEAD 789dcec, затем коммит передачи. Не теряй новые/чужие изменения.
Два раунда ревью ПЛАНА завершены, второй — один Opus; третий не запускать.
Реализация ещё не начиналась. Runtime-результаты в R2 принадлежат временной
реализации ревьюера, не этой ветке.

Для Claude: advisor Opus, исполнитель Sonnet medium, последовательные задачи,
один писатель на файл. Для Codex: исполняй доступными средствами, не угадывай
имена отсутствующих моделей. Необязательные отсутствующие superpowers skills
не блокируют прямое выполнение плана.

Выполни Tasks 0–7 до конца: feature branch feat/screens-redesign от подготовленной
ветки; merge --no-ff claude/screens-polish-24f596 и claude/desktop-layout-4055b7;
зелёная живая база; G1/G2 сначала осмысленно красные; затем меню, setup, lobby,
waiting, HUD; все проверки, скриншоты и отдельное ревью реализации.

Особенно соблюдай исправления R2: новая приватная комната на каждый контекст G1;
speed-only seg-2col в SettingsScreen; styles.css импортируется перед App;
phone mobile-hud margin-top:0/flex:1 и action-bar margin-top:auto;
legacy !hud 768 portrait сохраняется целиком; pmeta текст неизменен, diff sibling
pdiff; recovery ждёт enabled Готово; gear остаётся, wide rejoin ждёт board-svg;
перед resign открыть Ещё; убрать emoji имени бота/password/not-found;
не перезаписывать исторические PNG без точечного восстановления.

Не менять packages/core, worker, protocol, геометрию/вид доски, шашек и костей.
Не добавлять зависимости и не менять .github. Не пушить, не merge в main,
не деплоить. Коммиты по задачам, git add только явных путей.

npm run typecheck / npm test / npm run build; один wrangler dev на 8787.
NODE_PATH=$HOME/.npm/_npx/9833c18b2d85bc59/node_modules
NARDY_URL=http://127.0.0.1:8787
Playwright launch channel:'chrome'. Перед использованием проверь окружение.
Exit-код брать у команды, не у tail/grep. Все режимы e2e и безопасный bash-цикл
есть в Task 7. GATES.md заполнять реальными red/green доказательствами.

Проверь все темы, RU/EN, 360/768/1440, undo/recovery/rejoin/chat/resign/settings,
выбранную шашку и цели, численный контраст и console errors. Финальные снимки
redesign-*.png, отличия от дизайна перечислить. Приватный canvas может быть
недоступен: использовать спеку, честно назвать непроверенное соответствие.
Результат: реализованный редизайн, проверки и ревью реализации с доказательствами;
отдельно перечислить ограничения. Не выдавать локальные проверки за production.
```
