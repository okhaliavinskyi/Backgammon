#!/usr/bin/env node
// `node .claude/hooks/session-scope.test.mjs` — non-zero exit if the fix for
// F2 (session-scope forgets a session that only touched already-dirty files)
// regresses.
//
// Bug reproduced before this test existed: comparing `git status --porcelain`
// and HEAD alone gives `brought=false` for a session that edits a file which
// was ALREADY modified (or ALREADY untracked) before the session started —
// neither string changes. `contentMark()` (a hash of `git diff HEAD` plus the
// untracked file list with size+mtime) is the only thing that catches it.
//
// Each case builds its own throwaway git repo under a private TMPDIR sandbox
// (never the real ~/.claude or a real repo) and calls session-mark.mjs as a
// real child process — same as the hook runs in production — then imports
// sessionScope() in-process to read the result.

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Sandbox: one real-tmpdir call to create our own root, then TMPDIR points
// inside it for the rest of the run — session-mark.mjs (spawned) and
// sessionScope() (imported, in-process) both resolve marks under it, and
// nothing outside this root is ever touched.
const sandboxRoot = mkdtempSync(join(tmpdir(), "session-scope-test-"));
process.env.TMPDIR = sandboxRoot;

const { sessionScope } = await import("./session-scope.mjs");

function repoInit(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", ".");
  git("symbolic-ref", "HEAD", "refs/heads/main"); // deterministic branch name
  writeFileSync(join(dir, "keep.txt"), "orig\n");
  git("add", "keep.txt");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
  return { dir, git };
}

function mark(dir, sessionId, source) {
  return spawnSync("node", [join(here, "session-mark.mjs")], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ session_id: sessionId, source }),
    encoding: "utf8",
  });
}

function markPath(dir, sessionId) {
  const key = createHash("sha1").update(dir).digest("hex").slice(0, 12);
  return join(tmpdir(), `claude-session-mark-${key}`, `${sessionId}.json`);
}

const cleanupDirs = [sandboxRoot];
const cases = [];

// 1. Старт при уже modified файле, ничего не менять → brought=false, measured=session
{
  const { dir } = repoInit("scope-1-");
  cleanupDirs.push(dir);
  writeFileSync(join(dir, "keep.txt"), "dirty\n"); // dirty BEFORE the mark
  mark(dir, "s1", "startup");
  const scope = sessionScope(dir, "s1");
  cases.push([
    "already-dirty file untouched after mark → brought=false",
    scope.brought === false && scope.measured === "session",
    `brought=${scope.brought} measured=${scope.measured}`,
  ]);

  // 2. После отметки изменить содержимое того же modified файла → brought=true
  writeFileSync(join(dir, "keep.txt"), "dirty-again\n"); // same status line, new content
  const scope2 = sessionScope(dir, "s1");
  cases.push([
    "editing the same already-dirty file after mark → brought=true",
    scope2.brought === true,
    `brought=${scope2.brought}`,
  ]);
}

// 3. Изменить файл, вызвать compact с тем же id → отметка сохранена, brought=true
{
  const { dir } = repoInit("scope-3-");
  cleanupDirs.push(dir);
  mark(dir, "s3", "startup"); // baseline: clean tree
  const before = readFileSync(markPath(dir, "s3"), "utf8");
  writeFileSync(join(dir, "keep.txt"), "changed\n");
  mark(dir, "s3", "compact");
  const after = readFileSync(markPath(dir, "s3"), "utf8");
  const scope = sessionScope(dir, "s3");
  cases.push([
    "compact with same id preserves original mark, brought=true",
    before === after && scope.brought === true,
    `preserved=${before === after} brought=${scope.brought}`,
  ]);
}

// 4. То же для resume
{
  const { dir } = repoInit("scope-4-");
  cleanupDirs.push(dir);
  mark(dir, "s4", "startup");
  const before = readFileSync(markPath(dir, "s4"), "utf8");
  writeFileSync(join(dir, "keep.txt"), "changed\n");
  mark(dir, "s4", "resume");
  const after = readFileSync(markPath(dir, "s4"), "utf8");
  const scope = sessionScope(dir, "s4");
  cases.push([
    "resume with same id preserves original mark, brought=true",
    before === after && scope.brought === true,
    `preserved=${before === after} brought=${scope.brought}`,
  ]);
}

// 5. Fork с новым id и source fork → отметка существует, measured=session
{
  const { dir } = repoInit("scope-5-");
  cleanupDirs.push(dir);
  mark(dir, "s5-old", "startup");
  mark(dir, "s5-fork", "fork"); // new session_id: no existing file to skip against
  const scope = sessionScope(dir, "s5-fork");
  cases.push([
    "fork with a new session id gets its own mark, measured=session",
    existsSync(markPath(dir, "s5-fork")) && scope.measured === "session",
    `exists=${existsSync(markPath(dir, "s5-fork"))} measured=${scope.measured}`,
  ]);
}

// 6. clear после изменения → новая отметка, brought=false
{
  const { dir } = repoInit("scope-6-");
  cleanupDirs.push(dir);
  mark(dir, "s6", "startup"); // baseline: clean tree
  writeFileSync(join(dir, "keep.txt"), "clear-change\n");
  mark(dir, "s6", "clear"); // clear overwrites even though file already exists
  const scope = sessionScope(dir, "s6");
  cases.push([
    "clear after edits writes a fresh mark, brought=false",
    scope.brought === false,
    `brought=${scope.brought}`,
  ]);
}

// 7. Изменить существующий untracked файл (меняя размер) → brought=true
{
  const { dir } = repoInit("scope-7-");
  cleanupDirs.push(dir);
  writeFileSync(join(dir, "note.txt"), "a");
  mark(dir, "s7", "startup");
  writeFileSync(join(dir, "note.txt"), "a much longer untracked body than before");
  const scope = sessionScope(dir, "s7");
  cases.push([
    "editing an untracked file (size changes) → brought=true",
    scope.brought === true,
    `brought=${scope.brought}`,
  ]);
}

// 8. Feature-коммит в локальный bare fixture remote, upstream == HEAD, без
//    отметки → brought=true, база — merge-base с main, не upstream feature-ветки
{
  const bare = mkdtempSync(join(tmpdir(), "scope-8-bare-"));
  cleanupDirs.push(bare);
  spawnSync("git", ["init", "-q", "--bare", bare]);
  const { dir, git } = repoInit("scope-8-");
  cleanupDirs.push(dir);
  git("remote", "add", "origin", bare);
  git("push", "-q", "-u", "origin", "main");
  git("checkout", "-q", "-b", "feature/x");
  writeFileSync(join(dir, "feature.txt"), "feature work\n");
  git("add", "feature.txt");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "feature commit");
  git("push", "-q", "-u", "origin", "feature/x"); // upstream now in sync with HEAD
  const expectedBase = git("merge-base", "HEAD", "main").stdout.trim();
  const scope = sessionScope(dir, "s8"); // no mark written for this session
  cases.push([
    "feature branch synced with its upstream, no mark → brought=true via merge-base(main)",
    scope.brought === true && scope.base === expectedBase,
    `brought=${scope.brought} base=${scope.base} expected=${expectedBase}`,
  ]);
}

// 9. Репозиторий без единого коммита (F-регрессия: `git diff HEAD` бросал,
//    исключение убивало запись отметки целиком) → отметка всё равно пишется,
//    measured=session, а не откат на "branch"; новый untracked-файл после
//    отметки → brought=true, как и для обычного репозитория.
{
  const dir = mkdtempSync(join(tmpdir(), "scope-9-"));
  cleanupDirs.push(dir);
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", ".");
  writeFileSync(join(dir, "note.txt"), "a");
  mark(dir, "s9", "startup");
  const scope = sessionScope(dir, "s9");
  writeFileSync(join(dir, "another.txt"), "b");
  const scope2 = sessionScope(dir, "s9");
  cases.push([
    "no-commit repo: mark written (measured=session), new untracked file → brought=true",
    scope.measured === "session" && scope.brought === false && scope2.brought === true,
    `measured=${scope.measured} brought1=${scope.brought} brought2=${scope2.brought}`,
  ]);
}

let failed = 0;
for (const [name, ok, detail] of cases) {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name} — ${detail}`);
}

for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });

console.log(failed ? `${failed} case(s) failed` : `session scope: ${cases.length} cases pass`);
process.exit(failed ? 1 : 0);
