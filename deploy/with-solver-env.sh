#!/usr/bin/env bash
# Runs a command with the solver's settings loaded from the env file, the way systemd loads them
# for the service. Used by ferry-ops.sh (as the service user). The file is read as plain
# KEY=value lines: nothing in it is executed, a value may be wrapped in single or double quotes,
# and nothing is printed.
#
#   ENV_FILE=/etc/ferry/solver.env with-solver-env.sh <command> [arguments...]
set -euo pipefail

env_file="${ENV_FILE:-/etc/ferry/solver.env}"
if [ ! -r "$env_file" ]; then
  echo "with-solver-env: cannot read $env_file" >&2
  exit 1
fi

# systemd ignores spaces and carriage returns (a file saved on Windows has them) around a line and
# around the value; so does this.
trim() {
  local text="$1"
  text="${text%$'\r'}"
  text="${text#"${text%%[![:space:]]*}"}"
  text="${text%"${text##*[![:space:]]}"}"
  printf '%s' "$text"
}

while IFS= read -r line || [ -n "$line" ]; do
  line="$(trim "$line")"
  case "$line" in
    'export '*) line="$(trim "${line#export }")" ;;
  esac
  case "$line" in
    '' | '#'*) continue ;;
  esac
  key="$(trim "${line%%=*}")"
  value="$(trim "${line#*=}")"
  case "$key" in
    '' | *[!A-Za-z0-9_]*) continue ;;
  esac
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  export "$key=$value"
done < "$env_file"

exec "$@"
