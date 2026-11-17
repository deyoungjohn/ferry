#!/usr/bin/env bash
# Opt-in suites with durations. Run in the background; one log per suite in $1.
set -u
cd "$(dirname "$0")/../.."
out="${1:-.}"; mkdir -p "$out"
run() { name="$1"; shift; start=$(date +%s); echo "=== START $name"; "$@" > "$out/$name.log" 2>&1; code=$?; echo "=== END $name exit=$code seconds=$(( $(date +%s) - start ))"; }
run e2e env FERRY_RUN_E2E=1 pnpm --filter @ferry/e2e exec vitest run test/e2e.test.ts
run adversarial env FERRY_RUN_E2E=1 pnpm --filter @ferry/e2e exec vitest run test/adversarial.test.ts
run refusals pnpm --filter @ferry/e2e exec vitest run test/mainnet-refusals.test.ts
run rehearse env FERRY_RUN_REHEARSE=1 pnpm --filter @ferry/e2e exec vitest run test/rehearse.test.ts
run forkmatrix env FERRY_FORK_TESTS=1 pnpm --filter @ferry/htlc-evm exec vitest run test/fork.test.ts
run load env FERRY_RUN_LOAD=1 pnpm --filter @ferry/e2e exec vitest run test/load.test.ts
