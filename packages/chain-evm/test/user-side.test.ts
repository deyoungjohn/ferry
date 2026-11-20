import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  getAddress,
  http,
  parseAbi,
  parseSignature,
  sha256,
  stringToHex,
} from 'viem';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { evmLockId, parseOrderTerms } from '@ferry/core';
import type { Hex32, OrderTerms } from '@ferry/core';
import { loadChainData } from '@ferry/chain-config';
import type { TokenFacts } from '@ferry/chain-config';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import {
  buildClaimTransaction,
  buildLockIntentTypedData,
  buildOrderPermitTypedData,
  buildPermitTypedData,
  buildRefundTransaction,
  explorerTxUrl,
  getUserLockStatus,
  lockIntentFromTerms,
  planApproveAndLock,
  prepareApproveAndLock,
  readPermitNonce,
  UserSideError,
} from '../src/browser.js';
import type { AnvilInstance } from './anvil.js';
import { loadForgeArtifact, startAnvil } from './anvil.js';

const DEPLOYER = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const USER = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
);
const SOLVER = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);

const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function name() view returns (string)',
]);

interface ChainsFile {
  chains: Record<
    string,
    Record<'mainnet' | 'testnet', { tokens: TokenFacts[]; explorerUrl: string }>
  >;
}

describe('permit typed data from the configured facts', () => {
  const data = loadChainData() as ChainsFile;
  const permitTokens = Object.entries(data.chains).flatMap(([chain, c]) =>
    c.mainnet.tokens.filter((t) => t.permit).map((t) => ({ chain, token: t })),
  );

  it('derives a domain that matches the recorded separator for every permit token', () => {
    expect(permitTokens.length).toBeGreaterThanOrEqual(4);
    for (const { token } of permitTokens) {
      const typed = buildPermitTypedData({
        token,
        chainId: chainIdOf(data, token),
        owner: USER.address,
        spender: SOLVER.address,
        value: 1_000_000n,
        nonce: 0n,
        deadline: 2_000_000_000n,
      });
      expect(typed?.primaryType).toBe('Permit');
      expect(typed?.domain.name).toBe(token.name);
      expect(typed?.domain.version).toBe(token.version);
    }
  });

  it('uses version 2 for Circle USDC and a different version fails closed', () => {
    const usdc = permitTokens.find(
      (p) => p.chain === 'base' && p.token.symbol === 'USDC',
    )!.token;
    expect(usdc.version).toBe('2');
    const wrong = { ...usdc, version: '1' };
    expect(() =>
      buildPermitTypedData({
        token: wrong,
        chainId: 8453,
        owner: USER.address,
        spender: SOLVER.address,
        value: 1n,
        nonce: 0n,
        deadline: 1n,
      }),
    ).toThrow(UserSideError);
  });

  it('returns null for tokens without permit', () => {
    const usdt = data.chains['ethereum']!.mainnet.tokens.find(
      (t) => t.symbol === 'USDT',
    )!;
    expect(usdt.permit).toBe(false);
    expect(
      buildPermitTypedData({
        token: usdt,
        chainId: 1,
        owner: USER.address,
        spender: SOLVER.address,
        value: 1n,
        nonce: 0n,
        deadline: 1n,
      }),
    ).toBeNull();
  });

  it('refuses a permit when the recorded domain separator is missing', () => {
    const usdc = permitTokens[0]!.token;
    expect(() =>
      buildPermitTypedData({
        token: { ...usdc, domainSeparator: null },
        chainId: chainIdOf(data, usdc),
        owner: USER.address,
        spender: SOLVER.address,
        value: 1n,
        nonce: 0n,
        deadline: 1n,
      }),
    ).toThrow(UserSideError);
  });

  function chainIdOf(file: ChainsFile, token: TokenFacts): number {
    for (const c of Object.values(file.chains)) {
      if (c.mainnet.tokens.includes(token)) {
        return (c.mainnet as unknown as { chainId: number }).chainId;
      }
    }
    throw new Error('unknown token');
  }
});

describe('approve, claim and refund transactions (pure)', () => {
  const terms = makeTerms(
    'pure',
    '0x00000000000000000000000000000000000000aa',
    '0x00000000000000000000000000000000000000bb',
  );

  it('approves the exact amount when there is no allowance', () => {
    const plan = planApproveAndLock({ terms, allowance: 0n });
    expect(plan.map((t) => t.kind)).toEqual(['approve', 'lock']);
    const approve = decodeFunctionData({
      abi: parseAbi(['function approve(address,uint256)']),
      data: plan[0]!.data,
    });
    expect(approve.args).toEqual([getAddress(terms.evmHtlc), terms.evmAmount]);
  });

  it('resets a smaller non-zero allowance to zero first (Ethereum USDT only)', () => {
    const plan = planApproveAndLock({
      terms: {
        ...terms,
        evmChainId: 1,
        evmToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      },
      allowance: 5n,
    });
    expect(plan.map((t) => t.kind)).toEqual([
      'reset-approval',
      'approve',
      'lock',
    ]);
    const reset = decodeFunctionData({
      abi: parseAbi(['function approve(address,uint256)']),
      data: plan[0]!.data,
    });
    expect(reset.args).toEqual([getAddress(terms.evmHtlc), 0n]);
  });

  it('sends only the lock when the allowance already covers the amount', () => {
    const plan = planApproveAndLock({ terms, allowance: terms.evmAmount });
    expect(plan.map((t) => t.kind)).toEqual(['lock']);
  });

  it('encodes claim and refund for the contract', () => {
    const lockId = evmLockId(USER.address, terms.hashLock);
    const secret = `0x${'11'.repeat(32)}` as Hex32;
    const claim = buildClaimTransaction({
      htlc: terms.evmHtlc,
      lockId,
      secret,
    });
    expect(
      decodeFunctionData({ abi: ferryHtlcAbi, data: claim.data }),
    ).toMatchObject({ functionName: 'claim', args: [lockId, secret] });
    const refund = buildRefundTransaction({ htlc: terms.evmHtlc, lockId });
    expect(
      decodeFunctionData({ abi: ferryHtlcAbi, data: refund.data }),
    ).toMatchObject({ functionName: 'refund', args: [lockId] });
    expect(claim.to.toLowerCase()).toBe(terms.evmHtlc.toLowerCase());
  });

  it('builds explorer links without doubling slashes', () => {
    expect(explorerTxUrl('https://basescan.org/', '0xabc')).toBe(
      'https://basescan.org/tx/0xabc',
    );
  });
});

function makeTerms(
  label: string,
  htlc: string,
  token: string,
  overrides: Partial<OrderTerms> = {},
): OrderTerms {
  const secret = sha256(stringToHex(label));
  const now = Math.floor(Date.now() / 1000);
  return parseOrderTerms({
    version: 1,
    direction: 'EVM_TO_BCH',
    bchToken: 'PUSD',
    bchTokenCategory: `0x${'aa'.repeat(32)}`,
    bchTokenAmount: 2500n,
    evmAmount: 25_000_000n,
    evmToken: token,
    evmChainId: foundry.id,
    evmHtlc: htlc,
    userEvmAddress: USER.address,
    userBchLockingBytecode:
      '0x76a91400112233445566778899aabbccddeeff0011223388ac',
    solverEvmAddress: SOLVER.address,
    solverBchLockingBytecode:
      '0x76a91433221100ffeeddccbbaa9988776655443322110088ac',
    hashLock: sha256(secret),
    evmDeadline: now + 3600,
    bchRefundHeight: 200_000,
    bchCarrySats: 2000n,
    bchMaxFee: 1000n,
    quoteId: `q-${label}`,
    quoteExpiry: now + 600,
    pricing: {
      refs: [
        { asset: 'USDC', usdPrice: '1.00', source: 'test-fixture', asOf: now },
      ],
      spreadBps: 25,
      fixedFeeBase: 0n,
      rounding: 'floor',
    },
    ...overrides,
  });
}

describe('against a local chain', () => {
  let anvil: AnvilInstance;
  let pub: PublicClient;
  let deployer: WalletClient;
  let user: WalletClient;
  let solver: WalletClient;
  let htlc: Address;
  let permitToken: Address;
  let plainToken: Address;
  let permitFacts: Pick<
    TokenFacts,
    'address' | 'name' | 'version' | 'domainSeparator' | 'permit'
  >;

  beforeAll(async () => {
    anvil = await startAnvil();
    const transport = http(anvil.rpcUrl);
    pub = createPublicClient({
      chain: foundry,
      transport,
      cacheTime: 0,
      pollingInterval: 50,
    });
    const wallet = (account: typeof USER) =>
      createWalletClient({ account, chain: foundry, transport });
    deployer = wallet(DEPLOYER);
    user = wallet(USER);
    solver = wallet(SOLVER);

    const deploy = async (path: string, args: unknown[] = []) => {
      const artifact = loadForgeArtifact(path);
      const hash = await deployer.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
        account: DEPLOYER,
        chain: foundry,
      });
      return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
    };
    htlc = await deploy('FerryHTLC.sol/FerryHTLC.json');
    permitToken = await deploy(
      'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
    );
    plainToken = await deploy('MockNoReturnToken.sol/MockNoReturnToken.json', [
      'Tether USD',
      'USDT',
      6,
    ]);
    for (const token of [permitToken, plainToken]) {
      const hash = await deployer.writeContract({
        address: token,
        abi: tokenAbi,
        functionName: 'mint',
        args: [USER.address, 1_000_000_000n],
        account: DEPLOYER,
        chain: foundry,
      });
      await pub.waitForTransactionReceipt({ hash });
    }
    permitFacts = {
      address: permitToken,
      name: await pub.readContract({
        address: permitToken,
        abi: tokenAbi,
        functionName: 'name',
      }),
      version: '1',
      domainSeparator: await pub.readContract({
        address: permitToken,
        abi: tokenAbi,
        functionName: 'DOMAIN_SEPARATOR',
      }),
      permit: true,
    };
  });

  afterAll(async () => {
    await anvil.stop();
  });

  async function send(wallet: WalletClient, tx: { to: Address; data: Hex }) {
    const hash = await wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      account: wallet.account!,
      chain: foundry,
    });
    return pub.waitForTransactionReceipt({ hash });
  }

  async function lockWithPermitIntent(terms: OrderTerms) {
    const intent = buildLockIntentTypedData(terms);
    const nonce = await readPermitNonce(pub, permitToken, USER.address);
    const permit = buildOrderPermitTypedData(terms, permitFacts, nonce)!;
    const intentSig = await USER.signTypedData(intent);
    const permitSig = parseSignature(await USER.signTypedData(permit));
    const i = lockIntentFromTerms(terms);
    const hash = await solver.writeContract({
      address: htlc,
      abi: ferryHtlcAbi,
      functionName: 'lockWithIntent',
      args: [
        USER.address,
        i.token as Address,
        i.recipient as Address,
        i.amount,
        i.hashLock,
        i.deadline,
        i.intentDeadline,
        intentSig,
        permit.message.deadline,
        Number(permitSig.v),
        permitSig.r,
        permitSig.s,
      ],
      account: SOLVER,
      chain: foundry,
    });
    return pub.waitForTransactionReceipt({ hash });
  }

  it('a signature from these builders is accepted by lockWithIntent, then claim shows the secret', async () => {
    const terms = makeTerms('permit-claim', htlc, permitToken);
    const lockId = evmLockId(USER.address, terms.hashLock);
    const receipt = await lockWithPermitIntent(terms);
    expect(receipt.status).toBe('success');

    const opened = await getUserLockStatus({
      client: pub,
      htlc,
      lockId,
      explorerUrl: 'https://explorer.example',
      fromBlock: 0n,
    });
    expect(opened.state).toBe('open');
    expect(opened.locked?.txHash).toBe(receipt.transactionHash);
    expect(opened.locked?.url).toBe(
      `https://explorer.example/tx/${receipt.transactionHash}`,
    );

    const secret = sha256(stringToHex('permit-claim'));
    const claimed = await send(
      solver,
      buildClaimTransaction({ htlc, lockId, secret }),
    );
    expect(claimed.status).toBe('success');
    const after = await getUserLockStatus({
      client: pub,
      htlc,
      lockId,
      explorerUrl: 'https://explorer.example',
      fromBlock: 0n,
    });
    expect(after.state).toBe('claimed');
    expect(after.secret).toBe(secret);
    expect(after.claimed?.txHash).toBe(claimed.transactionHash);
  });

  it('a permit signed for another amount is rejected by the contract', async () => {
    const terms = makeTerms('permit-bad', htlc, permitToken);
    const intent = buildLockIntentTypedData(terms);
    const nonce = await readPermitNonce(pub, permitToken, USER.address);
    const permit = buildOrderPermitTypedData(
      { ...terms, evmAmount: terms.evmAmount + 1n },
      permitFacts,
      nonce,
    )!;
    const permitSig = parseSignature(await USER.signTypedData(permit));
    const i = lockIntentFromTerms(terms);
    await expect(
      solver.writeContract({
        address: htlc,
        abi: ferryHtlcAbi,
        functionName: 'lockWithIntent',
        args: [
          USER.address,
          i.token as Address,
          i.recipient as Address,
          i.amount,
          i.hashLock,
          i.deadline,
          i.intentDeadline,
          await USER.signTypedData(intent),
          permit.message.deadline,
          Number(permitSig.v),
          permitSig.r,
          permitSig.s,
        ],
        account: SOLVER,
        chain: foundry,
      }),
    ).rejects.toThrow();
  });

  it('approve and lock from the wallet for a token without permit, then expiry and refund', async () => {
    const terms = makeTerms('plain-refund', htlc, plainToken);
    const lockId = evmLockId(USER.address, terms.hashLock);
    const plan = await prepareApproveAndLock({ client: pub, terms });
    expect(plan.map((t) => t.kind)).toEqual(['approve', 'lock']);
    expect(plan[0]!.gasSource).toBe('node');
    expect(plan[1]!.gasSource).toBe('bound');
    for (const tx of plan) {
      expect((await send(user, tx)).status).toBe('success');
    }

    const open = await getUserLockStatus({
      client: pub,
      htlc,
      lockId,
      explorerUrl: 'https://explorer.example',
      fromBlock: 0n,
    });
    expect(open.state).toBe('open');
    expect(open.deadline).toBe(terms.evmDeadline);

    await pub.request({
      method: 'evm_setNextBlockTimestamp' as never,
      params: [terms.evmDeadline + 1] as never,
    });
    await pub.request({ method: 'evm_mine' as never, params: [] as never });
    const expired = await getUserLockStatus({
      client: pub,
      htlc,
      lockId,
      explorerUrl: 'https://explorer.example',
      fromBlock: 0n,
    });
    expect(expired.state).toBe('expired');

    const refund = await send(user, buildRefundTransaction({ htlc, lockId }));
    expect(refund.status).toBe('success');
    const refunded = await getUserLockStatus({
      client: pub,
      htlc,
      lockId,
      explorerUrl: 'https://explorer.example',
      fromBlock: 0n,
    });
    expect(refunded.state).toBe('refunded');
    expect(refunded.refunded?.txHash).toBe(refund.transactionHash);
    expect(refunded.secret).toBeNull();
  });

  it('approves directly over a smaller allowance for a token that allows it (no reset)', async () => {
    const hash = await user.writeContract({
      address: plainToken,
      abi: tokenAbi,
      functionName: 'approve',
      args: [htlc, 7n],
      account: USER,
      chain: foundry,
    });
    await pub.waitForTransactionReceipt({ hash });
    const terms = makeTerms('plain-reset', htlc, plainToken);
    const plan = await prepareApproveAndLock({ client: pub, terms });
    expect(plan.map((t) => t.kind)).toEqual(['approve', 'lock']);
  });

  it('reports an unknown lock as absent', async () => {
    const status = await getUserLockStatus({
      client: pub,
      htlc,
      lockId: `0x${'ee'.repeat(32)}`,
      explorerUrl: 'https://explorer.example',
      fromBlock: 0n,
    });
    expect(status.state).toBe('absent');
  });
});

describe('allowance reset rule', () => {
  it('applies to Ethereum USDT only, never to BNB Chain USDT', async () => {
    const { needsAllowanceReset } = await import('../src/user-side.js');
    expect(
      needsAllowanceReset(1, '0xdAC17F958D2ee523a2206206994597C13D831ec7'),
    ).toBe(true);
    expect(
      needsAllowanceReset(56, '0x55d398326f99059fF775485246999027B3197955'),
    ).toBe(false);
  });
});
