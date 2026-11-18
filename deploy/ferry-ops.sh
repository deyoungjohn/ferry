#!/usr/bin/env bash
# Everyday operations on the Ferry server. Run it from anywhere:
#
#   /opt/ferry/deploy/ferry-ops.sh health      check that everything works (changes nothing)
#   /opt/ferry/deploy/ferry-ops.sh update      pull, build, publish the site, restart, then check
#   /opt/ferry/deploy/ferry-ops.sh caddy       show and apply a changed Caddyfile
#   /opt/ferry/deploy/ferry-ops.sh logs        follow the solver's log
#   /opt/ferry/deploy/ferry-ops.sh rollback <commit>   put the code back and restart
#
# Run it as the normal login user (ubuntu), not with sudo: it asks for sudo only where needed.
# It never prints the contents of /etc/ferry/solver.env.
set -euo pipefail

FERRY_DIR="${FERRY_DIR:-/opt/ferry}"
ENV_FILE="${FERRY_ENV_FILE:-/etc/ferry/solver.env}"
WEB_ROOT="${FERRY_WEB_ROOT:-/var/www/ferry/dist}"
DOMAIN="${FERRY_DOMAIN:-ferry.incepture.dev}"
LOCAL_API="${FERRY_LOCAL_API:-http://127.0.0.1:8787}"
SERVICE="ferry-solver.service"
CADDYFILE="${FERRY_CADDYFILE:-/etc/caddy/Caddyfile}"
NODE_BIN="${FERRY_NODE_BIN:-/usr/local/bin/node}"

failures=0
say() { printf '%s\n' "$*"; }
ok() { printf '  [ok]   %s\n' "$*"; }
bad() { printf '  [FAIL] %s\n' "$*"; failures=$((failures + 1)); }
warn() { printf '  [warn] %s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }

need_dir() {
  if [ ! -d "$FERRY_DIR/.git" ]; then
    say "Cannot find the repository at $FERRY_DIR (set FERRY_DIR if it lives elsewhere)." >&2
    exit 2
  fi
}

# Runs a command as the service user with the solver's settings loaded from the env file, the way
# systemd loads them for the service (see with-solver-env.sh). Nothing in the file is printed.
as_solver() {
  sudo -u ferry env -i HOME=/nonexistent PATH="/usr/local/bin:/usr/bin:/bin" \
    ENV_FILE="$ENV_FILE" bash "$FERRY_DIR/deploy/with-solver-env.sh" "$@"
}

service_active() { systemctl is-active --quiet "$SERVICE"; }

wait_for_health() {
  local tries=30
  while [ "$tries" -gt 0 ]; do
    if curl -fsS --max-time 3 "$LOCAL_API/v1/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
    tries=$((tries - 1))
  done
  return 1
}

cmd_health() {
  need_dir
  section "Service"
  if service_active; then ok "$SERVICE is running"; else bad "$SERVICE is not running (try: sudo systemctl status $SERVICE --no-pager)"; fi
  if systemctl is-active --quiet caddy; then ok "caddy is running"; else bad "caddy is not running"; fi

  section "Solver answers"
  if health_json="$(curl -fsS --max-time 5 "$LOCAL_API/v1/health" 2>/dev/null)"; then
    ok "GET /v1/health answered"
    if command -v jq >/dev/null 2>&1; then
      printf '%s' "$health_json" | jq -r '"  ok=\(.ok)  version=\(.version // "?")  commit=\(.gitCommit // "?")"' 2>/dev/null || true
      printf '%s' "$health_json" | jq -r '.tips // empty | "  tips: bch=\(.bchHeight // "?") evm=\(.evm // {} | tostring)"' 2>/dev/null || true
      printf '%s' "$health_json" | jq -r '.costFeeds // {} | to_entries[] | "  feed \(.key): last ok \(.value.lastSuccessTime // "never"), cached=\(.value.cached // false), last error: \(.value.lastError // "none")"' 2>/dev/null || true
    fi
  else
    bad "GET $LOCAL_API/v1/health did not answer"
  fi
  if curl -fsS --max-time 5 "$LOCAL_API/v1/ready" >/dev/null 2>&1; then ok "GET /v1/ready answered"; else warn "GET /v1/ready did not answer"; fi

  section "Public site (https://$DOMAIN)"
  if curl -fsS --max-time 10 "https://$DOMAIN/v1/health" >/dev/null 2>&1; then ok "/v1/health through Caddy"; else bad "/v1/health through Caddy"; fi
  for path in / /app/swap /stats /recover.html; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN$path" || true)"
    if [ "$code" = "200" ]; then ok "$path -> 200"; else bad "$path -> ${code:-no answer}"; fi
  done

  section "Solver self-check (read-only: prices, balances, a \$1 dry-run quote per route)"
  if [ ! -r "$ENV_FILE" ] && ! sudo test -r "$ENV_FILE"; then
    bad "cannot read $ENV_FILE"
  else
    if (cd "$FERRY_DIR/packages/solver" && as_solver "$NODE_BIN" --conditions=ferry-source --import tsx src/selfcheck.ts); then
      ok "self-check passed"
    else
      bad "self-check reported a problem (read the lines above)"
    fi
  fi

  section "Recent solver errors (last 30 minutes)"
  recent="$(sudo journalctl -u "$SERVICE" --since '30 min ago' -p warning --no-pager -q 2>/dev/null | tail -n 15 || true)"
  if [ -n "$recent" ]; then warn "warnings or errors in the log:"; printf '%s\n' "$recent" | sed 's/^/    /'; else ok "no warnings or errors"; fi

  section "Result"
  if [ "$failures" -eq 0 ]; then say "  Everything checked is healthy."; else say "  $failures check(s) FAILED."; fi
  return "$failures"
}

cmd_update() {
  need_dir
  local assume_yes=0
  [ "${1:-}" = "-y" ] && assume_yes=1
  cd "$FERRY_DIR"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    say "The repository has local changes. Stopping so nothing is lost:" >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi
  local before after
  before="$(git rev-parse HEAD)"
  say "Current commit: $(git log -1 --format='%h %s' HEAD)"
  if [ "$assume_yes" -ne 1 ]; then
    say "Take a Lightsail snapshot first if this update is large."
    read -r -p "Update now? [y/N] " answer
    case "$answer" in y|Y) ;; *) say "Cancelled."; exit 0 ;; esac
  fi

  section "Pull"
  git pull --ff-only
  after="$(git rev-parse HEAD)"
  if [ "$before" = "$after" ]; then say "Already up to date ($(git log -1 --format='%h' HEAD))."; else git log --oneline "$before..$after"; fi

  section "Install"
  pnpm install --frozen-lockfile

  if [ "$before" != "$after" ] && ! git diff --quiet "$before" "$after" -- deploy/systemd deploy/bootstrap.sh; then
    section "Server setup changed: running bootstrap"
    sudo bash deploy/bootstrap.sh
  fi

  section "Build the site"
  pnpm --filter @ferry/web build
  sudo rsync -a --delete packages/web/dist/ "$WEB_ROOT/"
  sudo chown -R root:root "$WEB_ROOT"

  if [ "$before" != "$after" ] && ! git diff --quiet "$before" "$after" -- deploy/Caddyfile; then
    warn "deploy/Caddyfile changed in this update. Run: $0 caddy"
  fi

  section "Restart the solver"
  sudo systemctl restart "$SERVICE"
  if wait_for_health; then ok "solver is answering"; else bad "solver did not answer within a minute"; fi

  cmd_health || {
    say ""
    say "The update finished but a check failed. To put the previous code back:"
    say "  $0 rollback $before"
    return 1
  }
  say ""
  say "Updated: $(git log -1 --format='%h %s' HEAD)"
}

cmd_caddy() {
  need_dir
  local candidate
  candidate="$(mktemp)"
  trap 'rm -f "$candidate"' RETURN
  sed "s/example\\.org/$DOMAIN/g" "$FERRY_DIR/deploy/Caddyfile" > "$candidate"
  if sudo diff -u "$CADDYFILE" "$candidate" > /tmp/ferry-caddy.diff 2>&1; then
    say "The Caddyfile on this server already matches the repository."
    return 0
  fi
  say "Differences (current -> repository):"
  cat /tmp/ferry-caddy.diff
  if ! caddy validate --config "$candidate" --adapter caddyfile >/dev/null 2>&1; then
    say "The repository's Caddyfile does not validate. Not applying it:" >&2
    caddy validate --config "$candidate" --adapter caddyfile >&2 || true
    return 1
  fi
  read -r -p "Apply this Caddyfile and reload Caddy? [y/N] " answer
  case "$answer" in
    y|Y)
      sudo cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%Y%m%d%H%M%S)"
      sudo install -m 0644 -o root -g root "$candidate" "$CADDYFILE"
      sudo systemctl reload caddy
      say "Caddy reloaded. The previous file was saved next to it with a .bak suffix."
      ;;
    *) say "Not applied." ;;
  esac
}

cmd_logs() { sudo journalctl -u "$SERVICE" -f -n 50 --no-pager; }

cmd_rollback() {
  need_dir
  local target="${1:-}"
  if [ -z "$target" ]; then say "Usage: $0 rollback <commit>" >&2; exit 2; fi
  cd "$FERRY_DIR"
  git switch --detach "$target"
  pnpm install --frozen-lockfile
  pnpm --filter @ferry/web build
  sudo rsync -a --delete packages/web/dist/ "$WEB_ROOT/"
  sudo systemctl restart "$SERVICE"
  if wait_for_health; then say "Rolled back to $(git log -1 --format='%h %s' HEAD)."; else say "Rolled back, but the solver is not answering yet." >&2; exit 1; fi
}

case "${1:-}" in
  health) cmd_health ;;
  update) shift; cmd_update "$@" ;;
  caddy) cmd_caddy ;;
  logs) cmd_logs ;;
  rollback) shift; cmd_rollback "$@" ;;
  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
