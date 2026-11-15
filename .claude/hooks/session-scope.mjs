// Один ответ на вопрос «принесла ли эта работа что-нибудь» — для Stop-хуков.
//
// Живёт отдельно, потому что спрашивают двое: stop-gate (гонять ли проверку) и
// stop-selfaudit (спрашивать ли про лишнее). Пока ответ считался в каждом свой,
// определение базы стояло в двух файлах дословно — а расхождение между ними
// было бы дефектом, который никто не заметит: хуки молчат, когда всё хорошо.
//
// Читает, ничего не пишет и не бросает: git отсутствует или это не репозиторий —
// возвращается пустая область, и вызывающий сам решает, что с этим делать.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Мерка содержимого: рабочее дерево против HEAD плюс untracked-файлы (имя,
// размер, время правки). Правка уже грязного файла не меняет ни porcelain, ни
// HEAD — только эта мерка её и ловит. В репозитории без коммитов HEAD не на
// чем строить — `git diff HEAD` там просто пуст (nothing to diff against),
// untracked-перечисление это не задевает.
export function contentMark(cwd) {
  const run = (args) => execFileSync("git", args, {
    cwd, stdio: "pipe", encoding: "utf8",
  });
  const diffHead = () => {
    try {
      return run(["diff", "HEAD", "--no-color"]);
    } catch {
      return "";
    }
  };
  const untracked = run(["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0").filter(Boolean).sort().map((name) => {
      const st = statSync(join(cwd, name));
      return [name, st.size, st.mtimeMs];
    });
  return createHash("sha1")
    .update(diffHead())
    .update("\0")
    .update(JSON.stringify(untracked))
    .digest("hex");
}

// Отметка старта от session-mark.mjs. Её отсутствие — не повод молчать: без неё
// возвращаемся к мерке «ветка против базы». Худшая мерка лучше выключенных ворот.
function startMark(cwd, sessionId) {
  try {
    const key = createHash("sha1").update(cwd).digest("hex").slice(0, 12);
    return JSON.parse(readFileSync(join(tmpdir(), `claude-session-mark-${key}`, `${sessionId ?? "nosession"}.json`), "utf8"));
  } catch {
    return null;
  }
}

export function sessionScope(cwd, sessionId) {
  const git = (args) => {
    try {
      return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };

  if (git(["rev-parse", "--git-dir"]) === null)
    return { repo: false, dirty: "", base: null, commits: "", diff: "", brought: false, measured: "none" };

  const dirty = git(["status", "--porcelain"]) || "";

  // База без отметки — merge-base с main/master, не upstream feature-ветки.
  // Upstream, совпадающий с HEAD (ветка запушена), давал log/diff пустыми и
  // маскировал коммиты сверх main как «ничего не принесла».
  let base = null;
  for (const cand of ["main", "master"]) {
    if (git(["rev-parse", "--verify", "--quiet", cand])) {
      base = git(["merge-base", "HEAD", cand]);
      if (base) break;
    }
  }

  const commits = base ? git(["log", "--oneline", `${base}..HEAD`]) || "" : "";
  const diff = base ? git(["diff", "--stat", `${base}...HEAD`]) || "" : "";

  // ГЛАВНОЕ. Вопрос у Stop-хуков — «принесла ли что-нибудь ЭТА СЕССИЯ», а мерка
  // «ветка против main» отвечает на другой. Замер prompolitbot-4d 2026-08-31 в
  // общем worktree: сессия, не тронувшая ни файла, давала dirty 9 строк и 1
  // коммит — постоянный мусор untracked и коммит ветки недельной давности.
  // Фильтр становился тождественной истиной, то есть переставал фильтровать.
  const mark = startMark(cwd, sessionId);
  const head = git(["rev-parse", "HEAD"]) ?? "";
  let content = null;
  try { content = contentMark(cwd); } catch { /* статус/HEAD остаются меркой */ }
  const brought = mark
    ? mark.status !== dirty || mark.head !== head ||
      (content !== null && mark.content !== content)
    : Boolean(dirty || diff);

  return { repo: true, dirty, base, commits, diff, brought, measured: mark ? "session" : "branch" };
}
