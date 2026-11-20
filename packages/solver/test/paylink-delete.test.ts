import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as libauth from '@bitauth/libauth';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverConfigSchema } from '../src/config.js';
import type { SolverEngine } from '../src/engine/runner.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import type { PayLinkRecord } from '../src/db/types.js';

describe('Pay link delete with owner secret (Task B4-20 Item 4)', () => {
  let app: FastifyInstance;
  let db: SolverDatabase;

  const validRecipient = 'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk';
  const validLockingBytecode =
    '0x76a914111111111111111111111111111111111111111188ac';

  beforeAll(async () => {
    db = new SolverDatabase(':memory:');

    const config = SolverConfigSchema.parse({
      solverEvmPrivateKey: '0x' + '22'.repeat(32),
      operatorToken: 'test-token-at-least-32-chars-long-1234',
      allowMockPaylinkSignatures: true,
    });

    const engine = {
      isQuotingEnabled: () => true,
      start: async () => {},
      stop: () => {},
      earlyReleaseUserBchLock: async () => {},
    } as unknown as SolverEngine;

    const fakeBchClient = {
      getQuorumStatus: () => ({
        quorumTip: 330000,
        tips: { 'wss://mock1': 330000 },
        isQuorumHealthy: true,
        isLivenessHealthy: true,
        ageSeconds: 15,
        lastConfirmedAt: Math.floor(Date.now() / 1000) - 15,
      }),
      listUnspent: async () => [],
      getHistory: async () => [],
      broadcast: async () => '0xmock-bch-broadcast',
      subscribeScriptHash: async () => {},
      unsubscribeScriptHash: async () => {},
      close: () => {},
    } as unknown as BchQuorumClient;

    const fakeEvmAdapter = {
      getTip: async () => ({
        height: 12000000,
        ageSeconds: 2,
        stale: false,
      }),
      getBalance: async () => 100_000_000n,
      getNativeBalance: async () => 1_000_000_000_000_000_000n,
      estimateLockGas: async () => 100_000n,
      estimateClaimGas: async () => 80_000n,
      estimateRefundGas: async () => 60_000n,
      getBaseFee: async () => 1_000_000_000n,
      getGasPrice: async () => 1_500_000_000n,
    } as unknown as EvmChainAdapter;

    const priceSource = new MockPriceSource();

    app = buildServer({
      config,
      db,
      evmAdapter: fakeEvmAdapter,
      bchClient: fakeBchClient,
      priceSource,
      engine,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it('1. right secret deletes an unpaid pay link and answers as closed', async () => {
    const rawSecret = 'secret_test_key_12345';
    const secretHash =
      `0x${libauth.binToHex(libauth.sha256.hash(new TextEncoder().encode(rawSecret)))}`.toLowerCase();

    // Create pay link with ownerSecretHash
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/links',
      payload: {
        token: 'PUSD',
        recipientAddress: validRecipient,
        recipientLockingBytecode: validLockingBytecode,
        amountOut: '1000',
        memo: 'Invoice 1',
        ownerSecretHash: secretHash,
      },
    });

    expect(createRes.statusCode).toBe(200);
    const created = createRes.json();
    const linkId = created.id;

    // Delete with correct secret
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/links/${linkId}`,
      payload: { secret: rawSecret },
    });

    expect(deleteRes.statusCode).toBe(200);
    const deleteBody = deleteRes.json();
    expect(deleteBody.ok).toBe(true);
    expect(deleteBody.id).toBe(linkId);
    expect(deleteBody.status).toBe('closed');

    // Retrieve link: answers as closed
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/links/${linkId}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().status).toBe('closed');
  });

  it('2. wrong secret refuses with 401/403 UNAUTHORIZED', async () => {
    const rawSecret = 'secret_test_key_abcde';
    const secretHash =
      `0x${libauth.binToHex(libauth.sha256.hash(new TextEncoder().encode(rawSecret)))}`.toLowerCase();

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/links',
      payload: {
        token: 'PUSD',
        recipientAddress: validRecipient,
        recipientLockingBytecode: validLockingBytecode,
        amountOut: '2000',
        ownerSecretHash: secretHash,
      },
    });

    const linkId = createRes.json().id;

    // Try deleting with wrong secret
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/links/${linkId}`,
      payload: { secret: 'wrong_secret_value' },
    });

    expect(deleteRes.statusCode).toBe(401);
    expect(deleteRes.json().error.code).toBe('UNAUTHORIZED');

    // Link remains open
    const link = db.getPayLink(linkId);
    expect(link?.status).toBe('open');
  });

  it('3. missing secret refuses with 401/403 UNAUTHORIZED', async () => {
    const rawSecret = 'secret_test_key_xyz98';
    const secretHash =
      `0x${libauth.binToHex(libauth.sha256.hash(new TextEncoder().encode(rawSecret)))}`.toLowerCase();

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/links',
      payload: {
        token: 'PUSD',
        recipientAddress: validRecipient,
        recipientLockingBytecode: validLockingBytecode,
        amountOut: '3000',
        ownerSecretHash: secretHash,
      },
    });

    const linkId = createRes.json().id;

    // Try deleting with no secret
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/links/${linkId}`,
      payload: {},
    });

    expect(deleteRes.statusCode).toBe(401);
    expect(deleteRes.json().error.code).toBe('UNAUTHORIZED');
  });

  it('4. paid link refuses with 409 ALREADY_PAID', async () => {
    const rawSecret = 'secret_test_key_paid';
    const secretHash =
      `0x${libauth.binToHex(libauth.sha256.hash(new TextEncoder().encode(rawSecret)))}`.toLowerCase();

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/links',
      payload: {
        token: 'PUSD',
        recipientAddress: validRecipient,
        recipientLockingBytecode: validLockingBytecode,
        amountOut: '5000',
        ownerSecretHash: secretHash,
      },
    });

    const linkId = createRes.json().id;

    // Mark link as paid in DB
    const link = db.getPayLink(linkId)!;
    const paidLink: PayLinkRecord = {
      ...link,
      status: 'paid',
      orderId: '0x' + 'aa'.repeat(32),
    };
    db.savePayLink(paidLink);

    // Try deleting paid link
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/links/${linkId}`,
      payload: { secret: rawSecret },
    });

    expect(deleteRes.statusCode).toBe(409);
    expect(deleteRes.json().error.code).toBe('ALREADY_PAID');
    expect(deleteRes.json().error.message).toContain('paid');
  });
});
