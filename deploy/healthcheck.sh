#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="${FERRY_HEALTH_URL:-http://127.0.0.1:8787/v1/health}"
READY_URL="${FERRY_READY_URL:-http://127.0.0.1:8787/v1/ready}"

health="ok"
ready="ok"

if ! curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null; then
	health="fail"
fi

if ! curl -fsS --max-time 5 "$READY_URL" >/dev/null; then
	ready="fail"
fi

if [ "$health" != "ok" ] || [ "$ready" != "ok" ]; then
	printf 'ferry-health: health=%s ready=%s\n' "$health" "$ready" >&2
	exit 1
fi
