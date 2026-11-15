import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http } from 'viem';
import type { Abi, Hex } from 'viem';
import { foundry } from 'viem/chains';

const testDir = dirname(fileURLToPath(import.meta.url));
const htlcEvmDir = join(testDir, '..', '..', 'htlc-evm');

function resolveFoundryBin(name: string): string {
  const homeBin = join(process.env.HOME ?? '', '.foundry', 'bin', name);
  return existsSync(homeBin) ? homeBin : name;
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate free port'));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

export interface AnvilInstance {
  rpcUrl: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startAnvil(): Promise<AnvilInstance> {
  const port = await getFreePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvilBin = resolveFoundryBin('anvil');
  const proc: ChildProcess = spawn(
    anvilBin,
    ['--port', String(port), '--silent'],
    { stdio: 'pipe' },
  );

  const client = createPublicClient({
    chain: foundry,
    transport: http(rpcUrl),
  });

  await new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const onExit = (code: number | null) => {
      reject(new Error(`Anvil exited prematurely with code ${code}`));
    };
    proc.once('exit', onExit);

    const poll = async () => {
      try {
        await client.getBlockNumber();
        proc.off('exit', onExit);
        resolve();
      } catch {
        if (Date.now() - start > 15_000) {
          proc.off('exit', onExit);
          proc.kill('SIGKILL');
          reject(new Error('Anvil startup timed out'));
          return;
        }
        setTimeout(poll, 100);
      }
    };
    void poll();
  });

  return {
    rpcUrl,
    port,
    stop: async () => {
      if (proc.exitCode !== null || proc.killed) return;
      await new Promise<void>((resolve) => {
        proc.once('exit', () => resolve());
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill('SIGKILL');
          resolve();
        }, 2000).unref();
      });
    },
  };
}

export interface ForgeArtifact {
  abi: Abi;
  bytecode: Hex;
}

export function loadForgeArtifact(relativePath: string): ForgeArtifact {
  const artifactPath = join(htlcEvmDir, 'out', relativePath);
  if (!existsSync(artifactPath)) {
    execFileSync(resolveFoundryBin('forge'), ['build'], {
      cwd: htlcEvmDir,
      stdio: 'pipe',
    });
  }
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
    abi: Abi;
    bytecode: { object: Hex };
  };
  return {
    abi: raw.abi,
    bytecode: raw.bytecode.object,
  };
}
