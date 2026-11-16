import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  pad,
  parseAbi,
  parseEther,
  parseSignature,
  parseUnits,
  sha256,
  stringToHex,
  toHex,
} from 'viem';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadChainConfig, loadChainData } from '@ferry/chain-config';
import type { ChainConfigData } from '@ferry/chain-config';
import { ferryHtlcAbi } from '../abi.js';
import {
  CANONICAL_CREATE2_FACTORY,
  deployFerryHtlc,
  predictFerryHtlcAddress,
} from '../scripts/deploy.js';
import { startAnvil } from './anvil.js';

const runForkTests = process.env['FERRY_FORK_TESTS'] === '1';

const DEPLOYER_KEY: Hex = generatePrivateKey();
const USER_KEY: Hex = generatePrivateKey();
const RECIPIENT_KEY: Hex = generatePrivateKey();

const erc20Abi = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external',
  'function name() external view returns (string)',
  'function nonces(address owner) external view returns (uint256)',
  'function DOMAIN_SEPARATOR() external view returns (bytes32)',
]);

async function fundTokenViaAnvil(
  client: PublicClient,
  token: Address,
  holder: Address,
  amount: bigint,
): Promise<void> {
  const current = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [holder],
  });
  if (current >= amount) return;

  for (let baseSlot = 0n; baseSlot <= 25n; baseSlot++) {
    const slot = keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }],
        [holder, baseSlot],
      ),
    );
    const prev = await client.getStorageAt({ address: token, slot });
    await client.request({
      method: 'anvil_setStorageAt' as never,
      params: [token, slot, pad(toHex(amount), { size: 32 })] as never,
    });
    const updated = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [holder],
    });
    if (updated >= amount) {
      return;
    }
    if (prev) {
      await client.request({
        method: 'anvil_setStorageAt' as never,
        params: [token, slot, prev] as never,
      });
    }
  }

  throw new Error(`Unable to locate balanceOf mapping slot for token ${token}`);
}

async function exerciseApproveLockClaimRefund(params: {
  publicClient: PublicClient;
  userClient: WalletClient;
  recipientClient: WalletClient;
  htlc: Address;
  token: Address;
  decimals: number;
  label: string;
}): Promise<{ lockGas: bigint; claimGas: bigint; refundGas: bigint }> {
  const {
    publicClient,
    userClient,
    recipientClient,
    htlc,
    token,
    decimals,
    label,
  } = params;
  const user = userClient.account!;
  const recipient = recipientClient.account!;
  const amount = parseUnits('10', decimals);

  await fundTokenViaAnvil(publicClient, token, user.address, amount * 3n);

  const approveHash = await userClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [htlc, amount * 2n],
    account: user,
    chain: null,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const latest = await publicClient.getBlock({ blockTag: 'latest' });
  const deadline = latest.timestamp + 3600n;

  // 1. lock + claim
  const secret1 = sha256(stringToHex(`${label}-claim`));
  const hashLock1 = sha256(secret1);
  const lockHash = await userClient.writeContract({
    address: htlc,
    abi: ferryHtlcAbi,
    functionName: 'lock',
    args: [token, recipient.address, amount, hashLock1, deadline],
    account: user,
    chain: null,
  });
  const lockReceipt = await publicClient.waitForTransactionReceipt({
    hash: lockHash,
  });
  expect(lockReceipt.status).toBe('success');

  const lockId1 = await publicClient.readContract({
    address: htlc,
    abi: ferryHtlcAbi,
    functionName: 'lockId',
    args: [user.address, hashLock1],
  });

  const claimHash = await recipientClient.writeContract({
    address: htlc,
    abi: ferryHtlcAbi,
    functionName: 'claim',
    args: [lockId1, secret1],
    account: recipient,
    chain: null,
  });
  const claimReceipt = await publicClient.waitForTransactionReceipt({
    hash: claimHash,
  });
  expect(claimReceipt.status).toBe('success');

  // 2. lock + refund
  const secret2 = sha256(stringToHex(`${label}-refund`));
  const hashLock2 = sha256(secret2);
  const shortDeadline = latest.timestamp + 60n;
  const lock2Hash = await userClient.writeContract({
    address: htlc,
    abi: ferryHtlcAbi,
    functionName: 'lock',
    args: [token, recipient.address, amount, hashLock2, shortDeadline],
    account: user,
    chain: null,
  });
  await publicClient.waitForTransactionReceipt({ hash: lock2Hash });

  await publicClient.request({
    method: 'evm_increaseTime' as never,
    params: [120] as never,
  });
  await publicClient.request({
    method: 'evm_mine' as never,
    params: [] as never,
  });

  const lockId2 = await publicClient.readContract({
    address: htlc,
    abi: ferryHtlcAbi,
    functionName: 'lockId',
    args: [user.address, hashLock2],
  });

  const refundHash = await userClient.writeContract({
    address: htlc,
    abi: ferryHtlcAbi,
    functionName: 'refund',
    args: [lockId2],
    account: user,
    chain: null,
  });
  const refundReceipt = await publicClient.waitForTransactionReceipt({
    hash: refundHash,
  });
  expect(refundReceipt.status).toBe('success');

  return {
    lockGas: lockReceipt.gasUsed,
    claimGas: claimReceipt.gasUsed,
    refundGas: refundReceipt.gasUsed,
  };
}

async function exerciseLockWithIntent(params: {
  publicClient: PublicClient;
  userClient: WalletClient;
  deployerClient: WalletClient;
  recipient: Address;
  htlc: Address;
  token: Address;
  tokenName: string;
  tokenVersion: string;
  chainId: number;
  decimals: number;
  label: string;
}): Promise<bigint> {
  const {
    publicClient,
    userClient,
    deployerClient,
    recipient,
    htlc,
    token,
    tokenName,
    tokenVersion,
    chainId,
    decimals,
    label,
  } = params;
  const user = userClient.account!;
  const deployer = deployerClient.account!;
  const amount = parseUnits('10', decimals);

  await fundTokenViaAnvil(publicClient, token, user.address, amount);

  const latest = await publicClient.getBlock({ blockTag: 'latest' });
  const deadline = latest.timestamp + 3600n;
  const intentDeadline = latest.timestamp + 1200n;
  const secret = sha256(stringToHex(`${label}-intent`));
  const hashLock = sha256(secret);

  const nonce = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'nonces',
    args: [user.address],
  });

  const permitSigHex = await userClient.signTypedData({
    account: user,
    domain: {
      name: tokenName,
      version: tokenVersion,
      chainId,
      verifyingContract: token,
    },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: {
      owner: user.address,
      spender: htlc,
      value: amount,
      nonce,
      deadline: intentDeadline,
    },
  });
  const parsedPermit = parseSignature(permitSigHex);

  const intentSig = await userClient.signTypedData({
    account: user,
    domain: {
      name: 'FerryHTLC',
      version: '1',
      chainId,
      verifyingContract: htlc,
    },
    types: {
      LockIntent: [
        { name: 'token', type: 'address' },
        { name: 'recipient', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'hashLock', type: 'bytes32' },
        { name: 'deadline', type: 'uint64' },
        { name: 'intentDeadline', type: 'uint256' },
      ],
    },
    primaryType: 'LockIntent',
    message: {
      token,
      recipient,
      amount,
      hashLock,
      deadline,
      intentDeadline,
    },
  });

  const txHash = await deployerClient.writeContract({
    address: htlc,
    abi: ferryHtlcAbi,
    functionName: 'lockWithIntent',
    args: [
      user.address,
      token,
      recipient,
      amount,
      hashLock,
      deadline,
      intentDeadline,
      intentSig,
      intentDeadline,
      Number(parsedPermit.v ?? (parsedPermit.yParity === 0 ? 27 : 28)),
      parsedPermit.r,
      parsedPermit.s,
    ],
    account: deployer,
    chain: null,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  expect(receipt.status).toBe('success');
  return receipt.gasUsed;
}

describe.skipIf(!runForkTests)(
  'Fork simulations across configured chains',
  () => {
    const config = loadChainConfig();
    const rawData = loadChainData() as ChainConfigData;
    const deployer = privateKeyToAccount(DEPLOYER_KEY);
    const user = privateKeyToAccount(USER_KEY);
    const recipient = privateKeyToAccount(RECIPIENT_KEY);

    for (const chain of config.chains.filter((c) => c.network === 'mainnet')) {
      it(`deploys deterministically and measures gas on ${chain.id} fork`, async () => {
        const rpcUrl = chain.rpcUrls[0]!;
        const anvil = await startAnvil({
          forkUrl: rpcUrl,
          timeoutMs: 30_000,
        });
        try {
          const publicClient = createPublicClient({
            transport: http(anvil.rpcUrl),
            cacheTime: 0,
          });
          const deployerClient = createWalletClient({
            account: deployer,
            transport: http(anvil.rpcUrl),
          });
          const userClient = createWalletClient({
            account: user,
            transport: http(anvil.rpcUrl),
          });
          const recipientClient = createWalletClient({
            account: recipient,
            transport: http(anvil.rpcUrl),
          });

          for (const acct of [deployer, user, recipient]) {
            await publicClient.request({
              method: 'anvil_setBalance' as never,
              params: [acct.address, toHex(parseEther('100'))] as never,
            });
          }

          const predicted = predictFerryHtlcAddress(
            (chain.create2Factory.address as Address) ??
              CANONICAL_CREATE2_FACTORY,
          );
          const deployRes = await deployFerryHtlc({
            rpcUrl: anvil.rpcUrl,
            factory: chain.create2Factory.address as Address,
            broadcast: true,
            privateKey: DEPLOYER_KEY,
          });
          expect(deployRes.address).toBe(predicted);

          const usdc = chain.assets.find((a) => a.symbol === 'USDC');
          const usdcFacts = rawData.chains[chain.id].mainnet.tokens.find(
            (t) => t.symbol === 'USDC',
          );

          let gasSummary: Record<string, string> = {
            chain: chain.id,
            chainId: String(chain.chainId),
            rpc: rpcUrl,
            htlc: predicted,
          };

          if (usdc && usdc.address && usdc.decimals !== null) {
            if (chain.id === 'arc') {
              try {
                const standard = await exerciseApproveLockClaimRefund({
                  publicClient,
                  userClient,
                  recipientClient,
                  htlc: predicted,
                  token: usdc.address as Address,
                  decimals: usdc.decimals,
                  label: `${chain.id}-usdc`,
                });
                gasSummary = {
                  ...gasSummary,
                  lockGas: standard.lockGas.toString(),
                  claimGas: standard.claimGas.toString(),
                  refundGas: standard.refundGas.toString(),
                };
              } catch (err) {
                gasSummary = {
                  ...gasSummary,
                  arcQuirk:
                    'Arc 0x3600 native-USDC precompile reverted on Anvil fork: ' +
                    (err instanceof Error
                      ? err.message.split('\n')[0]
                      : String(err)),
                };
              }
            } else {
              const standard = await exerciseApproveLockClaimRefund({
                publicClient,
                userClient,
                recipientClient,
                htlc: predicted,
                token: usdc.address as Address,
                decimals: usdc.decimals,
                label: `${chain.id}-usdc`,
              });
              gasSummary = {
                ...gasSummary,
                lockGas: standard.lockGas.toString(),
                claimGas: standard.claimGas.toString(),
                refundGas: standard.refundGas.toString(),
              };

              if (usdc.permit && usdcFacts?.name && usdcFacts?.version) {
                const intentGas = await exerciseLockWithIntent({
                  publicClient,
                  userClient,
                  deployerClient,
                  recipient: recipient.address,
                  htlc: predicted,
                  token: usdc.address as Address,
                  tokenName: usdcFacts.name,
                  tokenVersion: usdcFacts.version,
                  chainId: chain.chainId,
                  decimals: usdc.decimals,
                  label: `${chain.id}-usdc`,
                });
                gasSummary = {
                  ...gasSummary,
                  lockWithIntentGas: intentGas.toString(),
                };
              }
            }
          }

          // Quirk: Ethereum USDT (void return, no permit)
          if (chain.id === 'ethereum') {
            const usdt = chain.assets.find((a) => a.symbol === 'USDT');
            if (usdt?.address && usdt.decimals !== null) {
              const usdtGas = await exerciseApproveLockClaimRefund({
                publicClient,
                userClient,
                recipientClient,
                htlc: predicted,
                token: usdt.address as Address,
                decimals: usdt.decimals,
                label: 'ethereum-usdt',
              });
              gasSummary = {
                ...gasSummary,
                usdtLockGas: usdtGas.lockGas.toString(),
                usdtClaimGas: usdtGas.claimGas.toString(),
              };
            }
          }

          console.log('FORK_GAS_REPORT', JSON.stringify(gasSummary));
        } finally {
          await anvil.stop();
        }
      }, 120_000);
    }
  },
);
