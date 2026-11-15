import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SolverDatabase } from '../src/db/database.js';

describe('Crash-simulation test (SIGKILL between intent and broadcast)', () => {
  let tempDbPath: string;
  let broadcastLogPath: string;

  beforeEach(() => {
    tempDbPath = path.join(
      process.cwd(),
      `test-crash-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    broadcastLogPath = path.join(
      process.cwd(),
      `test-broadcast-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    );
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(tempDbPath + suffix)) {
        try {
          fs.unlinkSync(tempDbPath + suffix);
        } catch {
          // ignore
        }
      }
    }
    if (fs.existsSync(broadcastLogPath)) {
      try {
        fs.unlinkSync(broadcastLogPath);
      } catch {
        // ignore
      }
    }
  });

  function spawnWorker(args: string[]): {
    child: ReturnType<typeof spawn>;
    readyPromise: Promise<void>;
    exitPromise: Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>;
  } {
    const workerScript = path.resolve(__dirname, 'helpers/crash-worker.ts');
    const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));
    const child = spawn(process.execPath, [tsxCli, workerScript, ...args], {
      cwd: path.resolve(__dirname, '..'),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    const readyPromise = new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.includes('READY')) {
          child.stdout.off('data', onData);
          resolve();
        }
      };
      child.stdout.on('data', onData);
      child.on('error', reject);
      child.on('close', (code, signal) => {
        if (!stdout.includes('READY')) {
          reject(
            new Error(
              `Worker closed before READY (code=${code}, signal=${signal}): ${stderr}`,
            ),
          );
        }
      });
    });

    const exitPromise = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.on('close', (code, signal) => {
        resolve({ code, signal });
      });
    });

    return { child, readyPromise, exitPromise };
  }

  it('kills process between intent and broadcast, restarts, and resumes action without duplicate or loss', async () => {
    const orderId = 'order-crash-test-1';

    // 1. Pre-seed order in database
    const initDb = new SolverDatabase(tempDbPath);
    initDb.saveOrder({
      id: orderId,
      direction: 'COUNTER_TO_BCH',
      status: 'USER_LOCK_FINAL',
      userCounterAddress: '0xuser',
      lockId: '0xlock',
      termsJson: '{}',
      hashLock: '0xhash',
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    });
    initDb.close();

    // 2. Start first process with crashBeforeBroadcast flag
    const worker1 = spawnWorker([
      '--dbPath',
      tempDbPath,
      '--orderId',
      orderId,
      '--broadcastLogPath',
      broadcastLogPath,
      '--crashBeforeBroadcast',
    ]);

    await worker1.readyPromise;
    const exit1 = await worker1.exitPromise;

    // Verify process 1 was terminated by SIGKILL (either via signal or exit code 137)
    expect(exit1.signal === 'SIGKILL' || exit1.code === 137).toBe(true);

    // Verify no broadcast reached the chain before crash
    expect(fs.existsSync(broadcastLogPath)).toBe(false);

    // 3. Inspect database: write-ahead intent is intact in WAL mode
    const inspectDb = new SolverDatabase(tempDbPath);
    const intentAction = inspectDb.getAction(orderId, 'SOLVER_LOCK');
    expect(intentAction).not.toBeNull();
    expect(intentAction?.status).toBe('PENDING');
    expect(intentAction?.txid).toBe('txid_crash_test');
    inspectDb.close();

    // 4. Restart process against the same database (without crashBeforeBroadcast)
    const worker2 = spawnWorker([
      '--dbPath',
      tempDbPath,
      '--orderId',
      orderId,
      '--broadcastLogPath',
      broadcastLogPath,
    ]);

    await worker2.readyPromise;
    const exit2 = await worker2.exitPromise;
    expect(exit2.code).toBe(0);

    // 5. Verify broadcast happened exactly once on restart with the pre-crash signed bytes
    expect(fs.existsSync(broadcastLogPath)).toBe(true);
    const broadcasts = fs
      .readFileSync(broadcastLogPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0]).toBe('0100000001pre_crash_signed_hex');

    // 6. Verify final database state: exactly ONE action record for this order and action
    const finalDb = new SolverDatabase(tempDbPath);
    const allActions = finalDb.listActionsForOrder(orderId);
    expect(allActions.length).toBe(1);
    expect(allActions[0]?.action).toBe('SOLVER_LOCK');
    expect(allActions[0]?.status).toBe('BROADCAST');
    expect(allActions[0]?.txid).toBe('txid_crash_test');
    finalDb.close();
  });
});
