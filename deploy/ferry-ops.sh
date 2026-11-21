#!/usr/bin/env bash
# Everyday operations on the Ferry server. Run it from anywhere:
#
#   /opt/ferry/deploy/ferry-ops.sh health      check that everything works (changes nothing)
#   /opt/ferry/deploy/ferry-ops.sh update [-y] [-b <branch>]   pull, build, publish the site, restart, then check
#                                              -b <branch> deploys that branch (to review a pull request live); -b main goes back
#   /opt/ferry/deploy/ferry-ops.sh caddy       show and apply a changed Caddyfile
#   /opt/ferry/deploy/ferry-ops.sh env         what is wrong with the settings file (shows no secret)
#   /opt/ferry/deploy/ferry-ops.sh logs        follow the solver's log
#   /opt/ferry/deploy/ferry-ops.sh rollback <commit>   put the code back and restart
#   /opt/ferry/deploy/ferry-ops.sh relay <cmd> manage the optional WizardConnect relay (install|status|logs|restart|remove|probe)
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

RELAY_CONTAINER="${FERRY_RELAY_CONTAINER:-ferry-relay}"
RELAY_IMAGE="scsibug/nostr-rs-relay:0.9.0@sha256:03f54bfbffff80a50db62c9287913bd25a2dec08033b56d2122bc2550363d5c5"
RELAY_PORT="${FERRY_RELAY_PORT:-8088}"
RELAY_CONFIG="${FERRY_RELAY_CONFIG:-$FERRY_DIR/deploy/relay/config.toml}"
RELAY_DATA_DIR="${FERRY_RELAY_DATA:-/var/lib/ferry/relay}"

failures=0
say() { printf '%s\n' "$*"; }
ok() { printf '  [ok]   %s\n' "$*"; }
bad() { printf '  [FAIL] %s\n' "$*"; failures=$((failures + 1)); }
warn() { printf '  [warn] %s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }

_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif sudo -n true 2>/dev/null; then
    sudo "$@"
  else
    "$@"
  fi
}

need_dir() {
  if [ ! -e "$FERRY_DIR/.git" ]; then
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

# The solver runs from source, so after a restart it compiles for a while before it answers: up to
# a couple of minutes on a small server. Waits up to the given number of seconds (default 180).
wait_for_health() {
  local budget="${1:-180}" waited=0
  while [ "$waited" -lt "$budget" ]; do
    if curl -fsS --max-time 3 "$LOCAL_API/v1/health" >/dev/null 2>&1; then return 0; fi
    if [ "$waited" -eq 0 ]; then say "  waiting for the solver to start (it compiles on start, up to ${budget}s)..."; fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

# Seconds since the solver service last started (0 if unknown).
solver_uptime_seconds() {
  local started
  started="$(systemctl show "$SERVICE" -p ActiveEnterTimestamp --value 2>/dev/null || true)"
  [ -z "$started" ] && { echo 0; return; }
  echo $(( $(date +%s) - $(date -d "$started" +%s 2>/dev/null || date +%s) ))
}

cmd_health() {
  need_dir
  section "Service"
  if service_active; then ok "$SERVICE is running"; else bad "$SERVICE is not running (try: sudo systemctl status $SERVICE --no-pager)"; fi
  if systemctl is-active --quiet caddy; then ok "caddy is running"; else bad "caddy is not running"; fi

  section "Solver answers"
  # Just restarted: give it time to compile and start before calling it a failure.
  if [ "$(solver_uptime_seconds)" -lt 240 ]; then wait_for_health 180 || true; fi
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

  section "Relay (optional)"
  if command -v docker >/dev/null 2>&1 && _sudo docker inspect -f '{{.State.Status}}' "$RELAY_CONTAINER" 2>/dev/null | grep -q "^running$"; then
    ok "relay is running ($RELAY_CONTAINER on 127.0.0.1:$RELAY_PORT)"
  else
    say "  [info] relay is not running (optional: $0 relay install)"
  fi

  section "Result"
  if [ "$failures" -eq 0 ]; then say "  Everything checked is healthy."; else say "  $failures check(s) FAILED."; fi
  return "$failures"
}

cmd_update() {
  need_dir
  local assume_yes=0 branch=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -y) assume_yes=1 ;;
      -b|--branch)
        branch="${2:-}"
        if [ -z "$branch" ]; then say "Usage: $0 update [-y] [-b <branch>]" >&2; exit 2; fi
        shift ;;
      *) say "Unknown option: $1. Usage: $0 update [-y] [-b <branch>]" >&2; exit 2 ;;
    esac
    shift
  done
  cd "$FERRY_DIR"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    say "The repository has local changes. Stopping so nothing is lost:" >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi
  local before after
  before="$(git rev-parse HEAD)"
  say "Current commit: $(git log -1 --format='%h %s' HEAD) ($(git rev-parse --abbrev-ref HEAD))"
  [ -n "$branch" ] && say "Deploying branch: $branch"
  if [ "$assume_yes" -ne 1 ]; then
    say "Take a Lightsail snapshot first if this update is large."
    read -r -p "Update now? [y/N] " answer
    case "$answer" in y|Y) ;; *) say "Cancelled."; exit 0 ;; esac
  fi

  section "Pull"
  if [ -n "$branch" ]; then
    git fetch origin "$branch"
    git switch -C "$branch" "origin/$branch"
  fi
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
  # No --delete: a tab opened before this deploy still asks for the previous build's chunks.
  # Hashed assets older than a week are removed instead.
  sudo rsync -a packages/web/dist/ "$WEB_ROOT/"
  sudo find "$WEB_ROOT/assets" -type f -mtime +7 -delete 2>/dev/null || true
  sudo chown -R root:root "$WEB_ROOT"

  if [ "$before" != "$after" ] && ! git diff --quiet "$before" "$after" -- deploy/Caddyfile; then
    warn "deploy/Caddyfile changed in this update. Run: $0 caddy"
  fi

  section "Restart the solver"
  sudo systemctl restart "$SERVICE"
  if wait_for_health; then ok "solver is answering"; else bad "solver did not answer within three minutes"; fi

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
  # Caddy's own user checks it (it opens the log file, which only that user may), so it must be
  # able to read the candidate.
  chmod 0644 "$candidate"
  if sudo diff -u "$CADDYFILE" "$candidate" > /tmp/ferry-caddy.diff 2>&1; then
    say "The Caddyfile on this server already matches the repository."
    return 0
  fi
  say "Differences (current -> repository):"
  cat /tmp/ferry-caddy.diff
  if ! sudo -u caddy caddy validate --config "$candidate" --adapter caddyfile >/dev/null 2>&1; then
    say "The repository's Caddyfile does not validate. Not applying it:" >&2
    sudo -u caddy caddy validate --config "$candidate" --adapter caddyfile >&2 || true
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

# Shows what is wrong with the env file without printing any secret: stray characters, and for
# each setting its name and length (only the public ones, network and contract addresses, are shown).
cmd_env() {
  if ! sudo test -r "$ENV_FILE"; then say "Cannot read $ENV_FILE" >&2; return 1; fi
  section "Shape of $ENV_FILE"
  local cr spaced
  cr="$(sudo grep -c $'\r' "$ENV_FILE" || true)"
  spaced="$(sudo grep -cE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]+=|=[[:space:]]+[^[:space:]]' "$ENV_FILE" || true)"
  say "  lines with a carriage return (saved on Windows): $cr"
  say "  lines with spaces around the = sign: $spaced"
  section "Settings (secrets show only their length)"
  sudo grep -E '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=' "$ENV_FILE" | tr -d '\r' | while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line#export }"
    key="${line%%=*}"; key="${key%"${key##*[![:space:]]}"}"
    value="${line#*=}"; value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"
    case "$key" in
      NETWORK|BASE_FERRY_HTLC_ADDRESS|BASE_USDC_ADDRESS|BASE_CHAIN_ID|MAX_SWAP_USD_MICROS|ENABLED_ROUTES) say "  $key = $value" ;;
      *) say "  $key (${#value} characters)" ;;
    esac
  done
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
  # No --delete: a tab opened before this deploy still asks for the previous build's chunks.
  # Hashed assets older than a week are removed instead.
  sudo rsync -a packages/web/dist/ "$WEB_ROOT/"
  sudo find "$WEB_ROOT/assets" -type f -mtime +7 -delete 2>/dev/null || true
  sudo systemctl restart "$SERVICE"
  if wait_for_health; then say "Rolled back to $(git log -1 --format='%h %s' HEAD)."; else say "Rolled back, but the solver is not answering yet." >&2; exit 1; fi
}

cmd_relay() {
  local sub="${1:-}"
  case "$sub" in
    install)
      need_dir
      if ! command -v docker >/dev/null 2>&1; then
        bad "Docker is required to run the relay container. Install docker first."
        return 1
      fi
      if [ ! -f "$RELAY_CONFIG" ]; then
        bad "Relay config not found at $RELAY_CONFIG"
        return 1
      fi
      section "Installing Ferry WizardConnect Relay"
      _sudo install -d -m 0777 "${RELAY_DATA_DIR}/db"
      if _sudo docker inspect "$RELAY_CONTAINER" >/dev/null 2>&1; then
        say "Stopping and removing existing $RELAY_CONTAINER container..."
        _sudo docker rm -f "$RELAY_CONTAINER" >/dev/null 2>&1 || true
      fi
      say "Launching pinned nostr-rs-relay container..."
      _sudo docker run -d \
        --name "$RELAY_CONTAINER" \
        --restart unless-stopped \
        -p "127.0.0.1:${RELAY_PORT}:8080" \
        --memory 256m \
        --cpus 0.5 \
        -v "$RELAY_CONFIG:/usr/src/app/config.toml:ro" \
        -v "${RELAY_DATA_DIR}/db:/usr/src/app/db" \
        "$RELAY_IMAGE" \
        ./nostr-rs-relay --config /usr/src/app/config.toml --db /usr/src/app/db
      sleep 2
      if _sudo docker inspect -f '{{.State.Status}}' "$RELAY_CONTAINER" 2>/dev/null | grep -q "^running$"; then
        ok "Relay container $RELAY_CONTAINER is running on 127.0.0.1:$RELAY_PORT"
      else
        bad "Relay container failed to start. Check logs: $0 relay logs"
        return 1
      fi
      ;;
    status)
      if ! command -v docker >/dev/null 2>&1; then
        say "Docker is not installed."
        return 1
      fi
      if ! _sudo docker inspect "$RELAY_CONTAINER" >/dev/null 2>&1; then
        say "Relay container $RELAY_CONTAINER does not exist (run: $0 relay install)."
        return 0
      fi
      section "Relay Container Status"
      local state
      state="$(_sudo docker inspect -f '{{.State.Status}}' "$RELAY_CONTAINER" 2>/dev/null || echo "unknown")"
      say "  Container:   $RELAY_CONTAINER ($state)"
      say "  Image:       $RELAY_IMAGE"

      local version="0.9.0"
      local nip11
      if nip11="$(curl -fsS -H "Accept: application/nostr+json" --max-time 2 "http://127.0.0.1:${RELAY_PORT}/" 2>/dev/null)"; then
        if command -v jq >/dev/null 2>&1; then
          version="$(printf '%s' "$nip11" | jq -r '.version // "0.9.0"')"
        fi
      fi
      say "  Version:     $version"

      local mem="0B"
      mem="$(_sudo docker stats --no-stream --format '{{.MemUsage}}' "$RELAY_CONTAINER" 2>/dev/null || echo "unknown")"
      say "  Memory:      $mem (cap: 256MB)"

      local conns=0
      if command -v ss >/dev/null 2>&1; then
        conns="$(ss -tn sport = :"$RELAY_PORT" or dport = :"$RELAY_PORT" 2>/dev/null | grep -c ESTAB || true)"
      fi
      say "  Connections: $conns active"

      local events=0
      local db_path="${RELAY_DATA_DIR}/db/nostr.db"
      if [ -f "$db_path" ]; then
        if command -v python3 >/dev/null 2>&1; then
          events="$(python3 -c "import sqlite3; con=sqlite3.connect('$db_path'); print(con.execute('SELECT count(*) FROM event').fetchone()[0])" 2>/dev/null || echo "0")"
        fi
      fi
      say "  Events:      $events stored in ephemeral SQLite (backup-free)"
      ;;
    logs)
      _sudo docker logs -f --tail 50 "$RELAY_CONTAINER"
      ;;
    restart)
      say "Restarting relay container $RELAY_CONTAINER..."
      _sudo docker restart "$RELAY_CONTAINER"
      ok "Relay container restarted."
      ;;
    remove)
      say "Removing relay container $RELAY_CONTAINER..."
      _sudo docker rm -f "$RELAY_CONTAINER" >/dev/null 2>&1 || true
      say "Relay container removed. Ephemeral DB directory (${RELAY_DATA_DIR}/db) preserved."
      ;;
    probe)
      local target="${2:-http://127.0.0.1:${RELAY_PORT}/}"
      section "Probing Relay ($target)"
      local resp
      if resp="$(curl -fsS -H "Accept: application/nostr+json" --max-time 5 "$target" 2>&1)"; then
        ok "Relay probe succeeded at $target"
        if command -v jq >/dev/null 2>&1; then
          printf '%s' "$resp" | jq '{name, version, supported_nips}' 2>/dev/null || echo "$resp"
        else
          echo "$resp"
        fi
      else
        bad "Relay probe failed at $target: $resp"
        return 1
      fi
      ;;
    *)
      say "Usage: $0 relay {install|status|logs|restart|remove|probe [url]}"
      return 2
      ;;
  esac
}

# The whole script is read before anything runs: `update -b` switches branches, which rewrites this
# file on disk, and bash must not read on from a changed file.
main() {
  case "${1:-}" in
    health) cmd_health ;;
    update) shift; cmd_update "$@" ;;
    caddy) cmd_caddy ;;
    env) cmd_env ;;
    logs) cmd_logs ;;
    rollback) shift; cmd_rollback "$@" ;;
    relay) shift; cmd_relay "$@" ;;
    *)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 2
      ;;
  esac
}

main "$@"; exit $?
