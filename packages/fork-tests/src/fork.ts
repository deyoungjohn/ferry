import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export interface ForkInstance {
  rpcUrl: string;
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a fork port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
    server.on('error', reject);
  });
}

async function body<T>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const payload = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? `fork RPC ${method} failed`);
  }
  if (payload.result === undefined) {
    throw new Error(`fork RPC ${method} returned no result`);
  }
  return payload.result;
}

export async function startFork(
  chainId: number,
  upstreamUrl: string,
): Promise<ForkInstance> {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    'anvil',
    [
      '--fork-url',
      upstreamUrl,
      '--chain-id',
      String(chainId),
      '--port',
      String(port),
      '--silent',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2_000);
  });

  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) {
      const sanitized = stderr
        .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
        .replace(/wss?:\/\/[^\s)]+/gi, '[redacted-url]')
        .trim();
      throw new Error(
        `anvil exited before the fork was ready for chain ${chainId}` +
          (sanitized === ''
            ? ''
            : `: ${sanitized.split('\n').slice(-2).join(' ')}`),
      );
    }
    try {
      const actual = Number(
        BigInt(await body<string>(rpcUrl, 'eth_chainId', [])),
      );
      if (actual === chainId) break;
    } catch {
      // Keep waiting for anvil.
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error('timed out waiting for the anvil fork');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    rpcUrl,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 3_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

export async function mine(rpcUrl: string): Promise<void> {
  await body(rpcUrl, 'anvil_mine', []);
}

export async function setIntervalMining(
  rpcUrl: string,
  seconds: number,
): Promise<void> {
  await body(rpcUrl, 'anvil_setIntervalMining', [seconds]);
}

export async function setBalance(
  rpcUrl: string,
  address: string,
  wei: bigint,
): Promise<void> {
  await body(rpcUrl, 'anvil_setBalance', [address, `0x${wei.toString(16)}`]);
}

export async function setStorageAt(
  rpcUrl: string,
  address: string,
  slot: string,
  value: string,
): Promise<void> {
  await body(rpcUrl, 'anvil_setStorageAt', [address, slot, value]);
}

export async function impersonateAccount(
  rpcUrl: string,
  address: string,
): Promise<void> {
  await body(rpcUrl, 'anvil_impersonateAccount', [address]);
}

export async function stopImpersonatingAccount(
  rpcUrl: string,
  address: string,
): Promise<void> {
  await body(rpcUrl, 'anvil_stopImpersonatingAccount', [address]);
}

export async function sendTransaction(
  rpcUrl: string,
  from: string,
  to: string,
  data: string,
): Promise<string> {
  return body<string>(rpcUrl, 'eth_sendTransaction', [{ from, to, data }]);
}
