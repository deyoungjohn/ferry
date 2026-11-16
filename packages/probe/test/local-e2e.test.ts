import { describe, expect, it } from 'vitest';
import {
  createDefaultBchPort,
  createDefaultEvmPort,
  parseProbeCliArgs,
  runProbe,
  type BchRpcTransport,
} from '../src/index.js';

const RUN_LOCAL_E2E = process.env.PROBE_LOCAL_E2E === '1';

describe.skipIf(!RUN_LOCAL_E2E)(
  'Opt-in local probe integration (anvil + fake Electrum + solver)',
  () => {
    it('runs forward and reverse probes against local solver setup', async () => {
      const { loadChainConfig } = await import('@ferry/chain-config');
      const { createPublicClient, createWalletClient, http } =
        await import('viem');
      const { privateKeyToAccount } = await import('viem/accounts');
      const { createJsonRpcBchTransport } = await import('../src/cli.js');

      const evmRpcUrl =
        process.env.PROBE_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
      const bchRpcUrl =
        process.env.PROBE_BCH_RPC_URL ?? 'http://127.0.0.1:8800';
      const solverUrl = process.env.PROBE_SOLVER_URL ?? 'http://127.0.0.1:8787';

      const chainConfig = loadChainConfig({ network: 'testnet' });
      const evmConfig = chainConfig.coreChains[0]!;
      const evmPrivateKey = process.env.PROBE_EVM_PRIVATE_KEY as `0x${string}`;
      const account = privateKeyToAccount(evmPrivateKey);

      const publicClient = createPublicClient({ transport: http(evmRpcUrl) });
      const walletClient = createWalletClient({
        account,
        transport: http(evmRpcUrl),
      });

      const evmPort = createDefaultEvmPort({
        chainConfig: evmConfig,
        publicClient,
        walletClient,
        userAddress: account.address,
      });
      const bchTransport: BchRpcTransport =
        createJsonRpcBchTransport(bchRpcUrl);
      const bchPort = createDefaultBchPort(bchTransport, 'chipnet');

      for (const direction of ['EVM_TO_BCH', 'BCH_TO_EVM'] as const) {
        const opts = parseProbeCliArgs([
          '--execute',
          '--direction',
          direction,
          '--solver-url',
          solverUrl,
        ]);
        const evidence = await runProbe(opts, { evmPort, bchPort });
        expect(evidence.status).toBe('claimed');
        expect(evidence.txids.claimTxid).toBeTruthy();
      }
    });
  },
);
