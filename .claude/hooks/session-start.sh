#!/bin/bash
# SessionStart: где я и что в дереве — видно сразу, без вопроса.
#
# Причина (prompolitbot, аварии 2026-08-13/15/19/24): чужой коммит лёг не в ту
# ветку; мердж ответил "Already up to date" по откаченному ref; чужое
# незакоммиченное чуть не уехало вместе со своим. Прозу можно не прочитать —
# этот вывод видит каждая сессия на старте.

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

branch=$(git branch --show-current 2>/dev/null)
last=$(git log -1 --format='%h %s (%cr)' 2>/dev/null)
dirty=$(git status --short 2>/dev/null | wc -l | tr -d ' ')

echo "Ветка: ${branch:-(detached)}"
echo "Последний коммит: ${last:-—}"
echo "Незакоммичено: ${dirty} файл(ов)"

if [ "${dirty:-0}" -gt 0 ]; then
  echo "⚠️  В дереве незакоммиченное — перед switch/restore/reset сверь, не чужое ли (git status)."
fi

if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  echo "⚠️  Это $branch. Модель работы и способ деплоя — в CLAUDE.md проекта."
fi
exit 0
