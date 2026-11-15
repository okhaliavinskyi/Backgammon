#!/usr/bin/env bash
# Выводит «Нарды» в прод на Cloudflare и включает CI/CD. Запуск с компьютера разработчика:
#   bash scripts/go-live.sh
# Каждый шаг проверяется; перед необратимыми действиями скрипт спрашивает подтверждение.
set -euo pipefail

REPO="okhaliavinskyi/Backgammon"
BRANCH="claude/loving-euler-j6gi1w"
DIR="${NARDY_DIR:-$HOME/Projects/Backgammon}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; exit 1; }
ask()  { local a; read -r -p "  $1 [y/N] " a </dev/tty; case "$a" in y*|Y*|д*|Д*) return 0;; *) return 1;; esac; }

# ---------- 1. Окружение ----------
say "1. Проверка окружения"
OS="$(uname -s)"
for t in git node npm curl; do command -v "$t" >/dev/null || die "Не найден $t"; done
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Нужен Node ≥ 20 (лучше 22), сейчас $(node -v)"
ok "git $(git --version | awk '{print $3}'), node $(node -v), npm $(npm -v)"
if ! command -v gh >/dev/null; then
  case "$OS" in
    Darwin) echo "  Установите GitHub CLI:  brew install gh" ;;
    Linux)  echo "  Установите GitHub CLI:  https://github.com/cli/cli/blob/trunk/docs/install_linux.md  (Debian/Ubuntu: sudo apt install gh)" ;;
    *)      echo "  Установите GitHub CLI:  winget install --id GitHub.cli" ;;
  esac
  die "Не найден gh — установите и запустите скрипт снова"
fi
ok "$(gh --version | head -1)"

# ---------- 2. GitHub CLI ----------
say "2. Авторизация GitHub"
[ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ] && warn "Задан GH_TOKEN/GITHUB_TOKEN — он перекрывает вход gh. Если дальше будут ошибки доступа: unset GH_TOKEN GITHUB_TOKEN"
if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "  Откроется вход через браузер. Ссылка: https://github.com/login/device — введите код, который gh напечатает ниже."
  gh auth login --web -h github.com -p https -s workflow,repo
fi
if ! gh auth status -h github.com 2>&1 | grep -q "'workflow'"; then
  echo "  Нужен scope workflow. Ссылка: https://github.com/login/device — введите код ниже."
  gh auth refresh -h github.com -s workflow
fi
gh auth setup-git -h github.com
ok "gh: $(gh api user --jq .login), scope workflow есть, git использует авторизацию gh"

say "Репозиторий: $DIR"
if [ ! -d "$DIR/.git" ]; then
  mkdir -p "$(dirname "$DIR")"
  gh repo clone "$REPO" "$DIR"
fi
cd "$DIR"
git fetch origin "$BRANCH"
if [ -n "$(git status --porcelain)" ]; then die "В $DIR есть незакоммиченные изменения — разберитесь с ними и запустите снова"; fi
git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -b "$BRANCH" "origin/$BRANCH"
git merge -q --ff-only "origin/$BRANCH"
ok "ветка $BRANCH, $(git log --oneline -1)"
npm ci --no-audit --no-fund
ok "npm ci"

# ---------- 3. Cloudflare ----------
say "3. Авторизация Cloudflare"
cd "$DIR/worker"
if npx wrangler whoami 2>&1 | grep -qi "not authenticated"; then
  echo "  Сейчас wrangler напечатает ссылку https://dash.cloudflare.com/oauth2/auth?... — откройте её в браузере и нажмите Allow."
  npx wrangler login --browser=false
fi
WHOAMI="$(npx wrangler whoami 2>&1)"
ACCS="$(grep -oE '[0-9a-f]{32}' <<<"$WHOAMI" | awk '!s[$0]++' || true)"
[ -n "$ACCS" ] || { echo "$WHOAMI"; die "Не удалось получить Account ID"; }
if [ "$(wc -l <<<"$ACCS" | tr -d ' ')" -gt 1 ]; then
  echo "$WHOAMI" | grep -E '[0-9a-f]{32}'
  read -r -p "  Вставьте Account ID, в который деплоить: " ACCOUNT_ID </dev/tty
else
  ACCOUNT_ID="$ACCS"
fi
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
ok "Account ID: $ACCOUNT_ID"

# ---------- 4. Проверки ----------
say "4. Проверки перед продом"
cd "$DIR"
npm run typecheck; ok "typecheck"
npm test; ok "unit-тесты"
npm run build; ok "сборка клиента"
(cd worker && npx wrangler deploy --dry-run --outdir .wrangler/dry); ok "wrangler dry-run"

# ---------- 5. Первый деплой ----------
say "5. Первый деплой"
echo "  Сейчас воркер nardy будет выложен в ваш аккаунт Cloudflare (публичный адрес *.workers.dev)."
ask "Деплоить?" || die "Остановлено пользователем"
LOG="$(mktemp)"
set +e; npm run deploy 2>&1 | tee "$LOG"; RC=${PIPESTATUS[0]}; set -e
URL="$(grep -oE 'https://[A-Za-z0-9.-]+\.workers\.dev' "$LOG" | head -1 || true)"
if [ "$RC" -ne 0 ] || [ -z "$URL" ]; then
  warn "Деплой не прошёл или не дал адрес *.workers.dev. Частая причина — нет поддомена workers.dev."
  echo "  Создайте его: https://dash.cloudflare.com/$ACCOUNT_ID/workers-and-pages  (Workers & Pages → Overview → выбрать поддомен), затем запустите скрипт снова."
  exit 1
fi
ok "URL: $URL"
echo "  Жду /api/health (новому поддомену иногда нужна минута)…"
for i in $(seq 1 24); do H="$(curl -fsS "$URL/api/health" 2>/dev/null || true)"; grep -q '"ok":true' <<<"$H" && break; sleep 5; done
grep -q '"ok":true' <<<"$H" || die "/api/health не ответил ok: $H"
ok "/api/health → $H"
for p in / /r/ABCDEF; do
  c="$(curl -s -o /dev/null -w '%{http_code}' "$URL$p")"; [ "$c" = 200 ] || die "$p → $c"; ok "$p → 200"
done
(cd worker && NARDY_URL="$URL" npm run test:integration); ok "интеграционные тесты против прода"

# ---------- 6. CI/CD ----------
say "6. Включение CI/CD"
if [ -d deploy/github-workflows ]; then
  git apply --index scripts/enable-ci.patch
  git rm -q scripts/enable-ci.patch
  git commit -qm "Enable CI/CD: move workflows to .github/workflows"
  ok "workflow'ы перенесены в .github/workflows, документация обновлена"
else
  ok "workflow'ы уже в .github/workflows"
fi
git push -u origin "$BRANCH"
ok "ветка запушена"

# ---------- 7. Секреты ----------
say "7. Секреты для GitHub Actions"
SECRETS="$(gh secret list -R "$REPO" 2>/dev/null || true)"
if grep -q '^CLOUDFLARE_API_TOKEN' <<<"$SECRETS" && ! ask "CLOUDFLARE_API_TOKEN уже задан. Заменить?"; then
  ok "CLOUDFLARE_API_TOKEN оставлен"
else
  cat <<EOF
  Создайте API-токен: https://dash.cloudflare.com/profile/api-tokens
    Create Token → шаблон «Edit Cloudflare Workers» → Account Resources: свой аккаунт → Continue → Create Token → Copy.
  Затем вставьте его ниже (ввод скрыт; в чат и файлы токен не попадает).
EOF
  gh secret set CLOUDFLARE_API_TOKEN -R "$REPO"
fi
gh secret set CLOUDFLARE_ACCOUNT_ID -R "$REPO" --body "$ACCOUNT_ID"
gh secret list -R "$REPO"
for s in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do gh secret list -R "$REPO" | grep -q "^$s" || die "нет секрета $s"; done
ok "оба секрета на месте"

# ---------- 8. main ----------
say "8. Ветка main"
echo "  Сейчас: push текущей ветки в main (запустит автодеплой) и main станет веткой по умолчанию."
ask "Продолжить?" || die "Остановлено пользователем"
git push origin HEAD:main
git branch -f main HEAD >/dev/null 2>&1 || true
gh repo edit "$REPO" --default-branch main
ok "main = $(git rev-parse --short HEAD), ветка по умолчанию"

# ---------- 9. CI/CD на main ----------
watch_main() {
  local sha="$1" ids=""
  echo "  Жду запуски для $sha…"
  for i in $(seq 1 30); do
    ids="$(gh run list -R "$REPO" --branch main --limit 20 --json databaseId,headSha,workflowName \
      --jq "map(select(.headSha==\"$sha\")) | .[] | \"\(.databaseId) \(.workflowName)\"")"
    grep -q "CI" <<<"$ids" && grep -q "Deploy" <<<"$ids" && break; sleep 5
  done
  [ -n "$ids" ] || die "запуски не появились"
  while read -r id name <&3; do
    echo "  -- $name ($id)"
    if ! gh run watch "$id" -R "$REPO" --exit-status --interval 10; then
      gh run view "$id" -R "$REPO" --log-failed | tail -80
      die "$name упал. Логи выше; после исправления: git push origin HEAD:main и снова этот скрипт"
    fi
    ok "$name зелёный"
  done 3<<<"$ids"
}
say "9. Проверка CI/CD"
watch_main "$(git rev-parse HEAD)"
H="$(curl -fsS "$URL/api/health")"; ok "прод после автодеплоя: $H"

# ---------- 10. e2e ----------
say "10. Браузерный e2e против прода"
npm install --no-save --no-audit --no-fund playwright >/dev/null
npx playwright install chromium
NARDY_URL="$URL" node e2e/online.e2e.cjs "$DIR/e2e-shots"; ok "e2e пройден, скриншоты: $DIR/e2e-shots"

# ---------- 11. Итог ----------
say "11. Отметка в docs/REVIEW.md"
node -e '
const fs=require("fs"),p="docs/REVIEW.md";let s=fs.readFileSync(p,"utf8");
s=s.split("\n").map(l=>l.startsWith("| 7 |")?"| 7 | CI зелёный, деплой при наличии секретов | Workflow'"'"'ы в `.github/workflows`; на `main` зелёные `CI` и `Deploy to Cloudflare`; прод '"$URL"': `/api/health` ok, интеграционные тесты и e2e против прода пройдены | ✅ |":l).join("\n");
fs.writeFileSync(p,s);'
if [ -n "$(git status --porcelain docs/REVIEW.md)" ]; then
  git commit -qm "REVIEW: criterion 7 (CI and deploy) done" docs/REVIEW.md
  echo "  Сейчас: push в main (ещё один автодеплой)."
  if ask "Запушить?"; then git push origin HEAD:main; watch_main "$(git rev-parse HEAD)"; git push origin HEAD:"$BRANCH"; fi
fi

printf "\n\033[1;32mГотово.\033[0m\n"
cat <<EOF
  Прод:              $URL
  Поделиться комнатой: создайте онлайн-комнату в игре и отправьте ссылку вида $URL/r/<КОД> (и пароль, если задан).
  Свой домен:        https://dash.cloudflare.com/$ACCOUNT_ID/workers/services/view/nardy/production/settings → Domains & Routes → Add → Custom domain
  Дальше:            любой push в main сам выкатывает новую версию.
EOF
