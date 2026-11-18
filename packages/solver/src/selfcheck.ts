#!/usr/bin/env node
import { runSelfCheck } from './ops/selfcheck.js';

async function main() {
  try {
    const report = await runSelfCheck({
      out: (line) => console.log(line),
    });
    process.exit(report.passed ? 0 : 1);
  } catch (err) {
    console.error('Fatal error during solver self-check:', err);
    process.exit(1);
  }
}

void main();
