#!/usr/bin/env node
// PreToolUse:Bash — пуш в main это деплой, а не сохранение работы.
//
// Правило из prompolitbot: то, что лежит в GitHub main, катится в прод само.
// Значит `git push origin main` — это выкатка, просто отложенная. Делать её
// без слова владельца нельзя, и нельзя сделать случайно.
//
// Второй запрет — `--no-verify`: он снимает git-хуки репозитория, то есть ровно
// те проверки, ради которых они заведены. Обходить гвард флагом = обходить гвард.
//
// Проектных проверок здесь нет: в свежем репозитории нет ни changelog, ни
// scripts/check-changelog.mjs, и ссылаться на них нельзя. Если такой скрипт в
// репозитории всё-таки заведут — гвард его подхватит, но не требует.

import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let command = "";
try {
  command = JSON.parse(raw || "{}")?.tool_input?.command ?? "";
} catch {
  process.exit(0); // не Bash-событие — пропустить
}

// Граница команды, а не просто вхождение: иначе гвард блокирует всё, где строка
// упоминается — heredoc с документацией, echo с JSON, коммит-сообщение.
const PUSH = /(^|[;&|\n]|&&|\|\|)\s*(sudo\s+)?git\s+push\b/;
const found = PUSH.exec(command);
if (!found) process.exit(0);

// Срез начинается с САМОЙ КОМАНДЫ, а не с разделителя, который регекс проглотил
// вместе с ней. `search()` возвращает индекс начала ВСЕГО совпадения, то есть
// `&&` в «cd x && ...»; срез с этой точки при разбиении по тем же разделителям
// давал ПУСТОЙ первый сегмент, рефспека не оставалось, и гвард откатывался на
// текущую ветку. В репозитории, который живёт на main, это отказ пушу чужой
// ветки — тот самый ложный отказ, от которого избавлялись 2026-08-31,
// вернувшийся с другой стороны.
//
// Найдено 2026-09-01: portfolio перевели на main, и следующая же составная
// команда с пушем фича-ветки получила «Пуш в main».
const at = found.index + found[0].search(/(?:sudo\s+)?git\b/);

// И дальше смотреть ТОЛЬКО на саму команду пуша, а не на всю строку. Первая
// версия искала `--no-verify` и `main` по всему тексту и отказала коммиту,
// который лишь ОПИСЫВАЛ этот флаг в своём сообщении: та же ошибка, от которой
// граница выше защищает `git push`, просто на шаг ниже.
// `sudo` снимается здесь, чтобы разбор ниже мог считать первые два слова
// командой и не съезжать на одно слово вправо.
const push = command
  .slice(at)
  .split(/[;\n]|&&|\|\||(?<!\|)\|(?!\|)/)[0]
  .replace(/^sudo\s+/, "");

const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (/(^|\s)--no-verify\b/.test(push)) {
  console.error(
    "⛔ `git push --no-verify` — это снятие git-хуков репозитория, то есть тех самых проверок.\n" +
      "Починить то, на что они ругаются, а не выключать их."
  );
  process.exit(2);
}

let branch = "";
try {
  branch = execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8" }).trim();
} catch {
  process.exit(0); // не репозиторий — не наше дело
}

// Блокирует ЦЕЛЬ пуша, а не текущую ветку. Разница видна только в репозитории,
// который живёт на main: там «блокировать, когда branch === main» отказывает и
// `git push origin feature/x`, который деплоем не является. Пять репозиториев
// из шести оказались именно такими (2026-08-31), и в portfolio это не всплыло
// только потому, что он стоял на feat-ветке.
//
// Цель рефспека — то, что после двоеточия; без двоеточия это сам аргумент.
// Сравнивать ЦЕЛЫЙ ref, а не подстроку: иначе `fix/main-nav` читается как main.
// Рефспека нет вовсе (`git push`, `git push origin`) — цель это текущая ветка.
// Перенаправления — не рефспеки. Команда без ветки целится в ТЕКУЩУЮ ветку, и
// на main это деплой; без этого фильтра `2>&1` считалось целью, цель выходила
// не main, и такая команда проходила.
const words = push
  .split(/\s+/)
  .filter(Boolean)
  .slice(2)
  .filter((w) => !w.startsWith("-") && !/[<>]/.test(w));
const refspecs = words.slice(1); // первое слово — remote
const targets = refspecs.length ? refspecs.map((r) => (r.includes(":") ? r.split(":").pop() : r)) : [branch];
const isMain = (ref) => /^(refs\/heads\/)?(main|master)$/.test(ref);
if (!targets.some(isMain)) process.exit(0);

const changelog = join(cwd, "scripts", "check-changelog.mjs");
if (existsSync(changelog)) {
  try {
    execSync("node scripts/check-changelog.mjs", { cwd, stdio: "inherit" });
  } catch {
    console.error("⛔ Пуш в main остановлен: реестр изменений не описывает то, что поедет.");
    process.exit(2);
  }
}

console.error(
  `⛔ Пуш в ${targets.find(isMain)} — это деплой, а не сохранение работы.\n` +
    "Что делать: работать в своей ветке и слить через PR, либо получить явное слово владельца на выкатку.\n" +
    "Если слово уже дано — скажи это в чате, и владелец подтвердит команду сам."
);
process.exit(2);
