#!/usr/bin/env node
// Stop guard — сессия не отдаёт работу на мердж, не сказав, что принесла лишнего.
//
// Требование владельца, 2026-08-31: дубли, неработающие функции, мёртвый код,
// слой, который не помогает, а только удорожает сопровождение. И отдельно —
// минусы сделанного, что можно было построить иначе, что вычистить сейчас.
//
// Хук не спрашивает вслепую. Голый вопрос "что можно было лучше?" получает
// вежливый список из ничего: отвечает тот же ум, который минуту назад считал
// написанное правильным. Поэтому сначала печатается то, что нельзя оспорить —
// реальный diff-stat того, что поедет в мердж, — и ответ требуется поимённо.
//
// Один раз за сессию (маркер по session_id): это ворота-вопрос, а не петля.
// stop_hook_active НЕ используется как ранний выход — иначе после срабатывания
// stop-gate самоаудит не выстрелил бы никогда. Одноразовость держит маркер,
// и он пишется до exit 2.

import { sessionScope } from "./session-scope.mjs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let input = {};
try {
  input = JSON.parse(raw || "{}");
} catch {
  process.exit(0);
}

const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const { repo, dirty, base, commits, diff, brought } = sessionScope(cwd, input.session_id);
if (!repo) process.exit(0);
if (!brought) process.exit(0); // сессия ничего не принесла — молчим

const key = createHash("sha1").update(cwd).digest("hex").slice(0, 12);
const dir = join(tmpdir(), `claude-selfaudit-${key}`);
const marker = join(dir, `${input.session_id ?? "nosession"}.asked`);
if (existsSync(marker)) process.exit(0);
mkdirSync(dir, { recursive: true });
writeFileSync(marker, "");

const block = (title, body) => (body ? `\n${title}\n${body}\n` : "");

console.error(
  `Самоаудит перед мерджем. Вот что поедет — отвечай по этому списку, не по памяти.\n` +
    block(`Коммиты сверх ${base}:`, commits) +
    block(`Изменено против ${base}:`, diff) +
    block("Незакоммичено в дереве:", dirty) +
    `\nОтветь на четыре вопроса, каждый пункт — с файлом и строкой:\n` +
    `1. Что из добавленного дублирует то, что в репозитории уже есть?\n` +
    `2. Что не работает, не вызывается или осталось мёртвым — импорт, ветка, функция, флаг?\n` +
    `3. Минусы построенного: где решение хуже очевидной альтернативы и почему выбрано оно?\n` +
    `4. Что можно вычистить прямо сейчас, не ломая проверок?\n\n` +
    `"Ничего" принимается только с перечислением добавленного и причиной, почему это не дубль.\n` +
    `Ответ идёт в описание PR или в хендофф — не только в чат.`
);
process.exit(2);
