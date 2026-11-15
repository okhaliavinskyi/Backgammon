#!/usr/bin/env node
// Stop guard — один проектный прогон проверки, прежде чем сессию назовут готовой.
//
// Сессия, которая закончилась без PR (хендофф, передача в другой worktree,
// прерванный раунд), никогда не доходит до проверок в момент отгрузки, и дрейф
// типов всплывает в следующей сессии как чужая проблема. Здесь та же команда
// гоняется один раз, на Stop, и ошибки возвращаются в разговор.
//
// Намеренно один раз за сессию: на втором Stop прогон пропускается, даже если
// команда всё ещё красная, — иначе действительно неисправимая ошибка запирает
// сессию в петле stop-fix-stop. Полезен именно первый, блокирующий проход;
// аварийный выход — то, что делает блокировку безопасной.
//
// Команда не зашита: берётся из package.json (scripts.typecheck, иначе
// scripts.test). Нет ни того ни другого — хук молчит и пропускает.

import { execFileSync } from "node:child_process";
import { sessionScope } from "./session-scope.mjs";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

let input = {};
try {
  input = JSON.parse(raw || "{}");
} catch {
  process.exit(0); // битый payload — не повод держать сессию
}

// Сессия, которая ничего не принесла, проверку не гоняет. Причина названа
// prompolitbot-4d 2026-08-31: в общем worktree плановый read-only прогон ловил
// полный набор тестов, мог покраснеть от ЧУЖОГО незакоммиченного и держал
// завершение не той сессии, которая сломала.
//
// Условие то же, что у stop-selfaudit: грязное дерево ИЛИ коммиты сверх базы.
// Не «чистый git status»: сессия, которая закоммитила работу, оставляет дерево
// чистым — и это ровно тот случай, где проверка нужнее всего.
const scope = sessionScope(cwd, input.session_id);
if (scope.repo && !scope.brought) process.exit(0);

let script = null;
try {
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  const s = pkg.scripts || {};
  script = s.typecheck ? "typecheck" : s.test ? "test" : null;
} catch {
  process.exit(0); // нет package.json — нечего гонять
}
if (!script) process.exit(0);

const key = createHash("sha1").update(cwd).digest("hex").slice(0, 12);
const dir = join(tmpdir(), `claude-stop-gate-${key}`);
const marker = join(dir, `${input.session_id ?? "nosession"}.ran`);
if (existsSync(marker)) process.exit(0);
mkdirSync(dir, { recursive: true });
writeFileSync(marker, "");

try {
  execFileSync("npm", ["run", "--silent", script], { cwd, stdio: "pipe", encoding: "utf8" });
} catch (err) {
  // ENOENT — самого npm нет (например, окружение без Node) — не наша забота,
  // молчим. Скрипт, упавший БЕЗ вывода, — другое дело: молчаливый провал
  // раньше проходил как успех неотличимо от отсутствующего npm.
  if (err.code === "ENOENT") process.exit(0);
  const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
  const head = out
    ? out.split("\n").slice(0, 40).join("\n")
    : `завершился кодом ${err.status ?? err.code ?? "unknown"} без вывода`;
  console.error(
    `npm run ${script} упал. Починить до конца сессии — или сказать в хендоффе прямо, ` +
      `что это оставлено открытым. В общем дереве ошибка может быть не твоя — ` +
      `сверь по git status, чьи файлы её дают:\n\n${head}`
  );
  process.exit(2); // 2 = stderr уходит обратно в разговор и держит завершение
}
