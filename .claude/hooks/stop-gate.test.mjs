#!/usr/bin/env node
// `node .claude/hooks/stop-gate.test.mjs` — non-zero exit if the fix for the
// `if (!out) process.exit(0)` defect regresses: a typecheck script that dies
// with no stdout/stderr (e.g. `process.exit(1)` with no message) used to look
// exactly like "npm isn't installed" and pass the gate silently. Now only a
// real ENOENT (npm missing) is silent; any other silent failure is reported
// with its exit code and blocks with exit 2.
//
// Each case builds its own throwaway git repo + package.json under a private
// TMPDIR sandbox and runs the real hook as a child process with a unique
// session_id (so the hook's own "ran once" marker never collides across
// cases or with a real session).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, "stop-gate.mjs");

const sandboxRoot = mkdtempSync(join(tmpdir(), "stop-gate-test-"));
process.env.TMPDIR = sandboxRoot;

function repoWithPackageJson(prefix, scripts) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", ".");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }));
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
  // dirty tracked file so sessionScope().brought is true without a session
  // mark — the gate must not exit early on "nothing to check" before we get
  // to the typecheck-failure logic under test.
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }, null, 2));
  return dir;
}

function runGate(dir, sessionId, env = {}) {
  return spawnSync("node", [hook], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    input: JSON.stringify({ session_id: sessionId }),
    encoding: "utf8",
  });
}

const cleanupDirs = [sandboxRoot];
const cases = [];

// 1. typecheck падает молча (exit 1, no stdout/stderr) → hook exit 2, текст
//    называет код возврата.
{
  const dir = repoWithPackageJson("gate-1-", { typecheck: 'node -e "process.exit(1)"' });
  cleanupDirs.push(dir);
  const res = runGate(dir, "g1");
  cases.push([
    "silent typecheck failure → exit 2 naming the exit code",
    res.status === 2 && /кодом 1 без вывода/.test(res.stderr),
    `status=${res.status} stderr=${JSON.stringify(res.stderr)}`,
  ]);
}

// 2. typecheck зелёный → exit 0
{
  const dir = repoWithPackageJson("gate-2-", { typecheck: 'node -e "process.exit(0)"' });
  cleanupDirs.push(dir);
  const res = runGate(dir, "g2");
  cases.push([
    "passing typecheck → exit 0",
    res.status === 0,
    `status=${res.status}`,
  ]);
}

// 3. npm недоступен (PATH без npm) → exit 0 по ENOENT
{
  const dir = repoWithPackageJson("gate-3-", { typecheck: 'node -e "process.exit(1)"' });
  cleanupDirs.push(dir);
  // A PATH holding ONLY a `node` symlink — enough to launch the hook itself,
  // but no real `npm` binary reachable, so execFileSync("npm", ...) throws
  // ENOENT. (Most Node installs put an `npm` symlink right next to `node`,
  // so simply pointing PATH at node's own bin dir would still find it.)
  const soleBin = mkdtempSync(join(tmpdir(), "gate-3-bin-"));
  cleanupDirs.push(soleBin);
  symlinkSync(process.execPath, join(soleBin, "node"));
  const res = runGate(dir, "g3", { PATH: soleBin });
  cases.push([
    "npm missing from PATH (ENOENT) → exit 0",
    res.status === 0,
    `status=${res.status} stderr=${JSON.stringify(res.stderr)}`,
  ]);
}

let failed = 0;
for (const [name, ok, detail] of cases) {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name} — ${detail}`);
}

for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });

console.log(failed ? `${failed} case(s) failed` : `stop gate: ${cases.length} cases pass`);
process.exit(failed ? 1 : 0);
