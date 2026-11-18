import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import type { Hex, PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  CANONICAL_CREATE2_FACTORY,
  deployFerryHtlc,
  predictFerryHtlcAddress,
} from '../scripts/deploy.js';
import { formatVerifyCommands } from '../scripts/verify-commands.js';
import type { AnvilInstance } from './anvil.js';
import { startAnvil } from './anvil.js';

const DEPLOYER_KEY: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('deterministic deployment script & verification helper', () => {
  let anvil: AnvilInstance;
  let publicClient: PublicClient;

  beforeAll(async () => {
    anvil = await startAnvil();
    publicClient = createPublicClient({
      transport: http(anvil.rpcUrl),
      cacheTime: 0,
    });
  });

  afterAll(async () => {
    if (anvil) {
      await anvil.stop();
    }
  });

  it('defaults to dry-run without sending a transaction, then deploys idempotently with --broadcast', async () => {
    const predicted = predictFerryHtlcAddress(CANONICAL_CREATE2_FACTORY);
    const deployerAddress = privateKeyToAccount(DEPLOYER_KEY).address;
    const nonceBefore = await publicClient.getTransactionCount({
      address: deployerAddress,
    });

    const dryRun = await deployFerryHtlc({ rpcUrl: anvil.rpcUrl });
    expect(dryRun.status).toBe('dry-run');
    expect(dryRun.address).toBe(predicted);
    expect(dryRun.deployBlock).toBeUndefined();

    const nonceAfterDryRun = await publicClient.getTransactionCount({
      address: deployerAddress,
    });
    expect(nonceAfterDryRun).toBe(nonceBefore);
    const codeBefore = await publicClient.getCode({ address: predicted });
    expect(codeBefore === undefined || codeBefore === '0x').toBe(true);

    const deployed = await deployFerryHtlc({
      rpcUrl: anvil.rpcUrl,
      broadcast: true,
      privateKey: DEPLOYER_KEY,
    });
    expect(deployed.status).toBe('deployed');
    expect(deployed.address).toBe(predicted);
    expect(deployed.deployBlock).toBeTypeOf('bigint');
    expect(deployed.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    // Re-running is idempotent when the exact same FerryHTLC bytecode is already there.
    const secondRun = await deployFerryHtlc({
      rpcUrl: anvil.rpcUrl,
      broadcast: true,
      privateKey: DEPLOYER_KEY,
    });
    expect(secondRun.status).toBe('already-deployed');
    expect(secondRun.address).toBe(predicted);
    // The block the contract first appeared in is found again, not lost.
    expect(secondRun.deployBlock).toBe(deployed.deployBlock);
  });

  it('refuses deployment if the predicted address already has different bytecode', async () => {
    const freshAnvil = await startAnvil();
    try {
      const predicted = predictFerryHtlcAddress(CANONICAL_CREATE2_FACTORY);
      const client = createPublicClient({
        transport: http(freshAnvil.rpcUrl),
      });
      await client.request({
        method: 'anvil_setCode' as never,
        params: [predicted, '0x600160005500'] as never,
      });

      await expect(
        deployFerryHtlc({
          rpcUrl: freshAnvil.rpcUrl,
          broadcast: true,
          privateKey: DEPLOYER_KEY,
        }),
      ).rejects.toThrow(/different bytecode/i);
    } finally {
      await freshAnvil.stop();
    }
  });

  it('prints forge verify-contract commands for all six configured chains', () => {
    const commands = formatVerifyCommands({ network: 'mainnet' });
    expect(commands.map((c) => c.chain)).toEqual(
      expect.arrayContaining([
        'base',
        'ethereum',
        'arbitrum',
        'arc',
        'bnb',
        'robinhood',
      ]),
    );
    for (const entry of commands) {
      expect(entry.command).toContain('forge verify-contract');
      expect(entry.command).toContain(entry.address);
      expect(entry.command).toContain(`--chain-id ${entry.chainId}`);
      expect(entry.command).toContain('--compiler-version 0.8.28');
      expect(entry.command).toContain('--via-ir');
      expect(entry.command).toContain('--evm-version cancun');
      expect(entry.command).toContain('--num-of-optimizations 200');
      expect(entry.command).not.toContain('--num-of-runs');
      expect(entry.command).toContain('--etherscan-api-key');
    }
  });
});
