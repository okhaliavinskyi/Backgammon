#!/usr/bin/env node
// SessionStart — запоминает, каким дерево было на старте сессии. Ничего не печатает.
//
// Отдельным файлом, а не строчкой в session-start.sh, намеренно: у репозитория
// может быть свой стартовый скрипт (в prompolitbot он и есть, со своим смыслом),
// и дописывать в чужой файл значит его сломать при следующем обновлении. Один
// хук — одно дело.
//
// Зачем вообще: без этой отметки Stop-хуки вынуждены мерить «ветка против main»,
// а вопрос у них другой — «эта сессия против своего старта». Разница не
// теоретическая. Замер prompolitbot-4d 2026-08-31 в общем worktree:
// `dirty lines: 9, commits: 1` у сессии, которая не тронула ни одного файла, —
// постоянный `graphify-out/`, чужие `.bak` и коммит ветки, живущий там неделями.
// Фильтр «принесла ли сессия что-нибудь» становился тождественной истиной,
// то есть переставал быть фильтром.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentMark } from "./session-scope.mjs";

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
const git = (args) => {
  try {
    return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

if (git(["rev-parse", "--git-dir"]) === null) process.exit(0);

try {
  const key = createHash("sha1").update(cwd).digest("hex").slice(0, 12);
  const dir = join(tmpdir(), `claude-session-mark-${key}`);
  const target = join(dir, `${input.session_id ?? "nosession"}.json`);

  // Перезаписывать отметку можно только на настоящем новом старте (`startup`,
  // `clear`) или когда файла ещё нет — форкнутая сессия получает новый
  // session_id и без отметки её не отличить от «сессия ничего не принесла».
  // `resume`/`compact` с уже существующей отметкой её не трогают: иначе
  // компакт стирает точку отсчёта и Stop-хуки слепнут после него.
  if (existsSync(target) && ["resume", "compact"].includes(input.source))
    process.exit(0);

  mkdirSync(dir, { recursive: true });
  writeFileSync(target, JSON.stringify({
    head: git(["rev-parse", "HEAD"]) ?? "",
    status: git(["status", "--porcelain"]) ?? "",
    content: contentMark(cwd),
  }));
} catch {
  // отметка — удобство, а не условие работы: Stop-хуки без неё честно
  // возвращаются к мерке «ветка против базы»
}
process.exit(0);
