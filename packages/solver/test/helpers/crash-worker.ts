import { parseArgs } from 'node:util';
import fs from 'node:fs';
import { SolverDatabase } from '../../src/db/database.js';
import { ActionExecutor } from '../../src/executor/action-executor.js';
import type { ChainPort } from '../../src/executor/types.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    dbPath: { type: 'string' },
    orderId: { type: 'string' },
    broadcastLogPath: { type: 'string' },
    crashBeforeBroadcast: { type: 'boolean' },
  },
});

if (!values.dbPath || !values.orderId) {
  process.exit(1);
}

// Signal readiness
process.stdout.write('READY\n');

const db = new SolverDatabase(values.dbPath);

const fakeChainPort: ChainPort = {
  broadcast: async (txHex: string) => {
    if (values.broadcastLogPath) {
      fs.appendFileSync(values.broadcastLogPath, `${txHex}\n`);
    }
    return 'txid_crash_test';
  },
  isOnChain: async () => false,
};

const executor = new ActionExecutor(db, fakeChainPort);

async function run() {
  try {
    const result = await executor.executeOrAdopt({
      orderId: values.orderId!,
      actionType: 'SOLVER_LOCK',
      buildTx: async () => ({
        txid: 'txid_crash_test',
        txHex: '0100000001pre_crash_signed_hex',
      }),
      faultBeforeBroadcast: values.crashBeforeBroadcast
        ? () => {
            // Emulate unexpected sudden crash (SIGKILL) right after SQLite write-ahead intent
            process.kill(process.pid, 'SIGKILL');
          }
        : undefined,
    });

    process.stdout.write(`SUCCESS:${result.txid}\n`);
    db.close();
    process.exit(0);
  } catch (err) {
    process.stderr.write(`ERROR:${String(err)}\n`);
    db.close();
    process.exit(1);
  }
}

void run();
