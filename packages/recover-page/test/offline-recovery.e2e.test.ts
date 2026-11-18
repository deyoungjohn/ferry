/**
 * The demonstration: the recovery page is opened FROM DISK in a real browser with the internet
 * blocked (only this computer is reachable), against a real local chain and a stand-in Bitcoin
 * Cash server. No Ferry website and no solver exist anywhere in this test.
 * Opt-in: needs Foundry's anvil and a local Chromium (FERRY_RUN_E2E=1).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import { serializeRecoveryFile } from '@ferry/core';
import { loadForgeArtifact, startAnvil, type AnvilInstance } from './anvil.js';
import { SECRET, fileJson, makeFile } from './fixture.js';
import { sha256 } from 'viem';

const run = process.env.FERRY_RUN_E2E === '1';
const describeE2e = run ? describe : describe.skip;

const DEPLOYER = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const USER = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const SOLVER = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
);
const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external',
]);
const PAGE = `file://${fileURLToPath(new URL('../../../recover.html', import.meta.url))}`;

function chromiumPath(): string {
  for (const build of ['1247', '1248']) {
    const path = join(
      homedir(),
      '.cache/ms-playwright',
      `chromium-${build}`,
      'chrome-linux64/chrome',
    );
    if (existsSync(path)) return path;
  }
  throw new Error('No local Chromium found');
}

describeE2e(
  'recovery page, opened from disk, with the internet blocked',
  () => {
    let anvil: AnvilInstance;
    let browser: Browser;
    let htlc: Address;
    let token: Address;
    let fulcrum: WebSocketServer;
    let fulcrumPort: number;
    const broadcasts: string[] = [];
    let covenantUtxo = false;
    const publicClient = () =>
      createPublicClient({
        chain: foundry,
        transport: http(anvil.rpcUrl),
        cacheTime: 0,
      });

    beforeAll(async () => {
      anvil = await startAnvil();
      const deployer = createWalletClient({
        account: DEPLOYER,
        chain: foundry,
        transport: http(anvil.rpcUrl),
      });
      const deploy = async (path: string, args: unknown[] = []) => {
        const artifact = loadForgeArtifact(path);
        const hash = await deployer.deployContract({
          abi: artifact.abi,
          bytecode: artifact.bytecode,
          args,
        });
        return (await publicClient().waitForTransactionReceipt({ hash }))
          .contractAddress!;
      };
      htlc = await deploy('FerryHTLC.sol/FerryHTLC.json');
      token = await deploy('MockERC20.sol/MockERC20.json', [
        'USD Coin',
        'USDC',
        6,
      ]);

      // A stand-in for a public Bitcoin Cash server: just enough of the protocol.
      fulcrum = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await new Promise<void>((resolve) => fulcrum.once('listening', resolve));
      fulcrumPort = (fulcrum.address() as { port: number }).port;
      fulcrum.on('connection', (socket) => {
        socket.on('message', (raw) => {
          const msg = JSON.parse(String(raw)) as {
            id: number;
            method: string;
            params: unknown[];
          };
          let result: unknown = null;
          if (msg.method === 'blockchain.headers.subscribe') {
            result = { height: 880_000, hex: '00' };
          } else if (msg.method === 'blockchain.scripthash.listunspent') {
            result = covenantUtxo
              ? [
                  {
                    tx_hash: '11'.repeat(32),
                    tx_pos: 0,
                    value: 3000,
                    height: 879_990,
                  },
                ]
              : [];
          } else if (msg.method === 'blockchain.transaction.broadcast') {
            broadcasts.push(String(msg.params[0]));
            result = 'ab'.repeat(32);
          }
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
        });
      });

      browser = await chromium.launch({ executablePath: chromiumPath() });
    }, 120_000);

    afterAll(async () => {
      await browser?.close();
      fulcrum?.close();
      await anvil?.stop();
    });

    async function openPage(): Promise<{
      page: import('playwright-core').Page;
      context: BrowserContext;
      blocked: string[];
    }> {
      const context = await browser.newContext({
        viewport: { width: 1000, height: 900 },
      });
      const blocked: string[] = [];
      // Only this computer is reachable: any other address is refused, as if offline.
      await context.route(
        (url) => !['127.0.0.1', 'localhost', ''].includes(url.hostname),
        (route) => {
          blocked.push(route.request().url());
          return route.abort();
        },
      );
      // A browser wallet that signs with the user's own account on the local chain.
      await context.addInitScript(
        ({ rpc, account }) => {
          let id = 0;
          const call = async (method: string, params: unknown[] = []) => {
            const res = await fetch(rpc, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: ++id,
                method,
                params,
              }),
            });
            const body = await res.json();
            if (body.error) throw new Error(body.error.message);
            return body.result;
          };
          (window as unknown as { ethereum: unknown }).ethereum = {
            request: async ({
              method,
              params,
            }: {
              method: string;
              params?: unknown[];
            }) => {
              if (method === 'eth_requestAccounts' || method === 'eth_accounts')
                return [account];
              if (method === 'wallet_switchEthereumChain') return null;
              return call(method, params ?? []);
            },
          };
        },
        { rpc: anvil.rpcUrl, account: USER.address },
      );
      const page = await context.newPage();
      await page.goto(PAGE);
      return { page, context, blocked };
    }

    async function useServers(page: import('playwright-core').Page) {
      await page
        .locator('summary', { hasText: 'Use different servers' })
        .click();
      await page.fill('#evm-endpoint', anvil.rpcUrl);
      await page.fill('#bch-server', `ws://127.0.0.1:${fulcrumPort}`);
    }

    it('refunds an EVM lock after the deadline using only the file, the chain and a wallet', async () => {
      const secret = sha256('0x7265636f7665722d70616765');
      const hashLock = sha256(secret);
      const amount = 10_000_000n;
      const latest = await publicClient().getBlock({ blockTag: 'latest' });
      const deadline = Number(latest.timestamp) + 60;
      const wallet = (account: typeof USER) =>
        createWalletClient({
          account,
          chain: foundry,
          transport: http(anvil.rpcUrl),
        });
      const wait = (hash: Hex) =>
        publicClient().waitForTransactionReceipt({ hash });
      await wait(
        await wallet(DEPLOYER).writeContract({
          address: token,
          abi: tokenAbi,
          functionName: 'mint',
          args: [USER.address, amount],
        }),
      );
      await wait(
        await wallet(USER).writeContract({
          address: token,
          abi: tokenAbi,
          functionName: 'approve',
          args: [htlc, amount],
        }),
      );
      await wait(
        await wallet(USER).writeContract({
          address: htlc,
          abi: ferryHtlcAbi,
          functionName: 'lock',
          args: [token, SOLVER.address, amount, hashLock, BigInt(deadline)],
        }),
      );
      const balanceBefore = await publicClient().readContract({
        address: token,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [USER.address],
      });
      expect(balanceBefore).toBe(0n);

      const file = makeFile({
        direction: 'EVM_TO_BCH',
        secret,
        deadline,
        evm: {
          chainId: foundry.id,
          htlc,
          token,
          user: USER.address,
          solver: SOLVER.address,
        },
      });

      const { page, context, blocked } = await openPage();
      await useServers(page);
      await page.setInputFiles('#file-input', {
        name: 'recovery.json',
        mimeType: 'application/json',
        buffer: Buffer.from(serializeRecoveryFile(file)),
      });

      // Before the deadline the page says to wait and offers no send.
      await page.locator('[data-testid="plan"]').waitFor();
      expect(await page.locator('[data-testid="plan"]').textContent()).toMatch(
        /Waiting for EVM refund deadline/,
      );
      expect(
        await page
          .getByRole('button', { name: /Send the refund with my wallet/ })
          .isDisabled(),
      ).toBe(true);

      // After the deadline the same page says it is ready.
      await publicClient().request({
        method: 'evm_increaseTime' as never,
        params: [120] as never,
      });
      await publicClient().request({
        method: 'evm_mine' as never,
        params: [] as never,
      });
      await page.click('summary:has-text("Use different servers") ~ button');
      await page
        .locator('[data-testid="evm-card"]:has-text("This is ready now")')
        .waitFor();

      await page
        .getByRole('button', { name: /Send the refund with my wallet/ })
        .click();
      await page
        .locator('[data-testid="evm-status"]:has-text("Sent.")')
        .waitFor();

      const balanceAfter = await publicClient().readContract({
        address: token,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [USER.address],
      });
      expect(balanceAfter).toBe(amount);
      // The page never tried to reach anything but this computer.
      expect(blocked).toEqual([]);
      await context.close();
    }, 120_000);

    it('builds and sends the Bitcoin Cash claim with no wallet and no signature', async () => {
      covenantUtxo = true;
      broadcasts.length = 0;
      const file = makeFile({
        direction: 'EVM_TO_BCH',
        evm: {
          chainId: foundry.id,
          htlc,
          token,
          user: USER.address,
          solver: SOLVER.address,
        },
      });
      const { page, context, blocked } = await openPage();
      await useServers(page);
      await page.setInputFiles('#file-input', {
        name: 'recovery.json',
        mimeType: 'application/json',
        buffer: Buffer.from(fileJson(file)),
      });
      const card = page.locator('[data-testid="bch-card"]');
      await card.waitFor();
      expect(await card.textContent()).toMatch(
        /needs no wallet and no signature/,
      );
      await card
        .getByRole('button', { name: /Send the claim through a public server/ })
        .click();
      await page
        .locator('[data-testid="bch-status"]:has-text("Sent.")')
        .waitFor();
      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0]).toMatch(/^[0-9a-f]+$/);
      // What was sent is exactly what the page showed for copying.
      await card.locator('summary').click();
      expect((await card.locator('pre.wrap').textContent())?.trim()).toBe(
        broadcasts[0],
      );
      expect(blocked).toEqual([]);
      covenantUtxo = false;
      await context.close();
    }, 120_000);

    it('says plainly what is wrong when the file is not a recovery file', async () => {
      const { page, context } = await openPage();
      await page.fill('#file-text', '{"hello": 1}');
      await page.getByRole('button', { name: 'Read the pasted file' }).click();
      expect(await page.locator('#output').textContent()).toMatch(
        /not a Ferry recovery file/,
      );
      await context.close();
    }, 60_000);

    void SECRET;
  },
);
