import { spawn } from 'node:child_process';
import net from 'node:net';

export interface AnvilInstance {
  rpcUrl: string;
  port: number;
  stop: () => Promise<void>;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to bind ephemeral port')));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForRpc(rpcUrl: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_chainId',
          params: [],
        }),
      });
      if (res.ok) {
        return;
      }
    } catch {
      // Anvil is still starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for anvil at ${rpcUrl}`);
}

export async function startAnvil(options?: {
  forkUrl?: string | undefined;
  timeoutMs?: number | undefined;
}): Promise<AnvilInstance> {
  const port = await getFreePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const args = ['--port', String(port), '--silent'];
  if (options?.forkUrl) {
    args.push('--fork-url', options.forkUrl);
  }

  const proc = spawn('anvil', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const stop = async () => {
    if (proc.killed || proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 2_000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      proc.kill('SIGTERM');
    });
  };

  try {
    await waitForRpc(rpcUrl, options?.timeoutMs ?? 15_000);
    return { rpcUrl, port, stop };
  } catch (err) {
    await stop();
    throw new Error(
      `Failed to start anvil${options?.forkUrl ? ` (fork: ${options.forkUrl})` : ''}: ${String(err)}${stderr ? `\n${stderr}` : ''}`,
      { cause: err },
    );
  }
}
