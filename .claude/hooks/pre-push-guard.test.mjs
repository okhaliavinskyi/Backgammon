#!/usr/bin/env node
// `node .claude/hooks/pre-push-guard.test.mjs` — exits 1 if the guard blocks
// the wrong thing.
//
// It shipped with two false positives, both of the same kind: it searched the
// WHOLE bash command instead of the push in it, so a commit message that
// merely described `--no-verify` was refused, and a branch called
// `fix/main-nav` read as a push to main. A guard that cries wolf gets worked
// around, which is worse than no guard.
//
// Then a third, found by rolling the template into six repositories on
// 2026-08-31: the guard blocked on the CURRENT branch, so in a repository that
// lives on main it refused `git push origin feature/x` too. Five of the six
// were like that. It did not show up in portfolio only because that checkout
// happened to sit on a feature branch — which is why this file no longer runs
// against whatever repository it is in. It builds its own, on a known branch,
// and the same nine-plus cases now answer the same way everywhere.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const guard = join(here, "pre-push-guard.mjs");

function repoOn(branch) {
  const dir = mkdtempSync(join(tmpdir(), "guard-test-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  git("switch", "-qc", branch);
  return dir;
}

const onFeature = repoOn("feat/probe");
const onMain = repoOn("main");

// [ожидаемый код, репозиторий, имя, команда]
const cases = [
  [0, onFeature, "a feature branch", "git push -u origin chore/project-tooling"],
  [2, onFeature, "main by name", "git push origin main"],
  [2, onFeature, "main by refspec", "git push origin HEAD:main"],
  [2, onFeature, "main fully qualified", "git push origin HEAD:refs/heads/main"],
  [0, onFeature, "a branch whose NAME holds main", "git push -u origin fix/main-nav"],
  // The flag has to appear LITERALLY here, outside the push, or this case
  // passes against a guard that scans the whole command — which is the very
  // defect it exists to catch. Checked by putting that defect back.
  [0, onFeature, "a message describing the flag", 'git commit -m "it refuses --no-verify" && git push origin feat/x'],
  [0, onFeature, "a message mentioning main", 'git commit -m "merged into main" && git push origin feat/x'],
  [2, onFeature, "the flag actually used", "git push --no-verify origin feat/x"],
  [0, onFeature, "not a push at all", "git status && git log --oneline -1"],
  [0, onFeature, "bare push from a feature branch", "git push"],
  // Сидя на main, деплоем является пуш СВОЕЙ ветки, а не любой:
  [2, onMain, "bare push while sitting on main", "git push"],
  [2, onMain, "remote only, no refspec, on main", "git push origin"],
  [0, onMain, "someone else's branch, pushed from main", "git push origin feature/x"],
  // Четвёртый ложный отказ, найденный 2026-09-01, и он был у КАЖДОГО из этих
  // случаев на main: регекс проглатывает разделитель вместе с командой, срез
  // начинался с него, первый сегмент выходил пустым — рефспек терялся, и гвард
  // откатывался на текущую ветку. На feat-ветке это незаметно, потому что
  // откат туда безобиден; на main он отказывает всему.
  [0, onMain, "a feature branch after cd", "cd /tmp && git push -u origin fix/some-branch"],
  [0, onMain, "a feature branch after a commit", 'git commit -m "x" && git push origin feat/x'],
  [0, onMain, "a feature branch after a semicolon", "cd /tmp; git push origin feat/x"],
  [2, onMain, "the default branch after cd", "cd /tmp && git push origin main"],
  [2, onFeature, "the default branch after cd, from a feature branch", "cd /tmp && git push origin main"],
  // Перенаправление — не рефспек: без ветки цель это текущая ветка, а на main
  // такая команда деплой.
  [2, onMain, "redirection and no refspec, on main", "git push origin 2>&1"],
  [0, onFeature, "redirection after a feature refspec", "git push origin feat/x 2>&1"],
  // sudo сдвигал разбор на слово вправо: первые два слова переставали быть
  // командой, и целью читался сам `git`.
  [2, onFeature, "sudo to the default branch", "sudo git push origin main"],
  [0, onFeature, "sudo to a feature branch", "sudo git push origin feat/x"],
];

let failed = 0;
for (const [want, root, name, command] of cases) {
  const { status } = spawnSync("node", [guard], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  const ok = status === want;
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name} — exit ${status}, want ${want}`);
}

for (const dir of [onFeature, onMain]) rmSync(dir, { recursive: true, force: true });

console.log(failed ? `${failed} case(s) failed` : `${cases.length} cases pass`);
process.exit(failed ? 1 : 0);
