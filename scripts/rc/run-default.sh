#!/usr/bin/env bash
# Default suite with per-step durations. Run in the background: nohup scripts/rc/run-default.sh > rc-default.log 2>&1 &
set -u
cd "$(dirname "$0")/../.."
pnpm -r exec rm -rf dist
for step in "pnpm format:check" "pnpm typecheck" "pnpm lint" "pnpm test:unit" "pnpm test" "pnpm check:private"; do
  start=$(date +%s)
  echo "=== START $step"
  $step; code=$?
  echo "=== END $step exit=$code seconds=$(( $(date +%s) - start ))"
done
