import {
  orderId as computeOrderId,
  quoteOut,
  signOrderId,
  type Hex,
  type Hex32,
  type OrderTerms,
} from '@ferry/core';
import {
  QuoteRequestSchema,
  type LiquidityResponse,
  type OrderStatusResponse,
  type PegsResponse,
  type RecentOrdersResponse,
  type StatsResponse,
} from '@ferry/core/api';
import type { FetchLike } from '@ferry/solver-client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export interface MockSolverServer {
  readonly fetch: FetchLike;
  readonly signerAddress: Hex;
  readonly ephemeralKey: Hex;
}

export function createMockSolverFetch(): MockSolverServer {
  // Generate ephemeral private key at startup - no hardcoded key material anywhere
  const ephemeralKey = generatePrivateKey();
  const mockAccount = privateKeyToAccount(ephemeralKey);

  const storedOrders = new Map<string, OrderStatusResponse>();
  const payLinks = new Map<string, Record<string, unknown>>();

  const fetchHandler: FetchLike = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlString =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const parsedUrl = new URL(urlString, 'https://mock-solver-alpha.local');
    const pathname = parsedUrl.pathname;
    const isBeta =
      parsedUrl.hostname.includes('beta') || urlString.includes('beta');
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const now = Math.floor(Date.now() / 1000);

    // Helper to return JSON Response
    function jsonResponse(data: unknown, status = 200): Response {
      const body = JSON.stringify(data, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      return new Response(body, {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Health
    if (pathname === '/v1/health') {
      return jsonResponse({
        ok: true,
        quotingEnabled: true,
        timestamp: now,
      });
    }

    // 2. Liquidity
    if (pathname === '/v1/liquidity') {
      const liquidity: LiquidityResponse = {
        routes: [
          {
            route: 'pusd:chipnet',
            asset: 'PUSD',
            decimals: 2,
            available: '500000',
            inventory: '1000000',
            exposure: '0',
            reserved: '0',
          },
          {
            route: 'musd:chipnet',
            asset: 'MUSD',
            decimals: 2,
            available: '500000',
            inventory: '1000000',
            exposure: '0',
            reserved: '0',
          },
          {
            route: 'usdc:base',
            asset: 'USDC',
            decimals: 6,
            available: '5000000000',
            inventory: '10000000000',
            exposure: '0',
            reserved: '0',
          },
          {
            route: 'usdc:ethereum',
            asset: 'USDC',
            decimals: 6,
            available: '5000000000',
            inventory: '10000000000',
            exposure: '0',
            reserved: '0',
          },
          {
            route: 'usdc:arbitrum',
            asset: 'USDC',
            decimals: 6,
            available: '5000000000',
            inventory: '10000000000',
            exposure: '0',
            reserved: '0',
          },
        ],
        asOf: now,
      };
      return jsonResponse(liquidity);
    }

    // 3. Stats
    if (pathname === '/v1/stats') {
      const stats: StatsResponse = {
        completedSwaps: 42,
        totalVolumeUsd: '12850.00',
        medianFastSeconds: 35,
        quotePolicy: {
          spreadBps: 40,
          fixedFeeBase: '50000',
          minUsd: '1.00',
          maxUsd: '100.00',
        },
        asOf: now,
      };
      return jsonResponse(stats);
    }

    // 4. Recent orders
    if (pathname === '/v1/orders/recent') {
      const recent: RecentOrdersResponse = {
        orders: [
          {
            orderId:
              '0x1111111111111111111111111111111111111111111111111111111111111101',
            direction: 'EVM_TO_BCH',
            bchToken: 'PUSD',
            evmChainId: 84532,
            bchTokenAmount: '1987',
            evmAmount: '20000000',
            settledAt: now - 3600,
            durationSeconds: 42,
          },
          {
            orderId:
              '0x1111111111111111111111111111111111111111111111111111111111111102',
            direction: 'BCH_TO_EVM',
            bchToken: 'PUSD',
            evmChainId: 84532,
            bchTokenAmount: '5000',
            evmAmount: '49750000',
            settledAt: now - 7200,
            durationSeconds: 38,
          },
        ],
        asOf: now,
      };
      return jsonResponse(recent);
    }

    // 5. Pegs
    if (pathname === '/v1/pegs') {
      const pegs: PegsResponse = {
        tokens: [
          {
            asset: 'PUSD',
            currentUsdPrice: '0.998',
            points: [
              { at: now - 86400, usdPrice: '0.999' },
              { at: now - 43200, usdPrice: '0.997' },
              { at: now, usdPrice: '0.998' },
            ],
          },
          {
            asset: 'MUSD',
            currentUsdPrice: '1.001',
            points: [
              { at: now - 86400, usdPrice: '1.000' },
              { at: now - 43200, usdPrice: '1.002' },
              { at: now, usdPrice: '1.001' },
            ],
          },
        ],
        asOf: now,
      };
      return jsonResponse(pegs);
    }

    // 6. Chains
    if (pathname === '/v1/chains') {
      return jsonResponse({
        chains: [
          {
            chainId: 84532,
            name: 'Base Sepolia',
            enabled: true,
            confirmations: { fast: 1, safe: 3 },
            tokens: [
              {
                symbol: 'USDC',
                address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
                decimals: 6,
                permit: true,
              },
            ],
          },
        ],
        asOf: now,
      });
    }

    // 7. Quotes (POST /v1/quotes)
    if (pathname === '/v1/quotes' && method === 'POST') {
      const rawBody =
        typeof init?.body === 'string'
          ? JSON.parse(init.body)
          : input instanceof Request
            ? await input.json()
            : {};
      const request = QuoteRequestSchema.parse(rawBody);

      // Beta solver simulates refusal on amounts >= 80 USD
      const isBetaOverLiquidity =
        isBeta &&
        (request.direction === 'EVM_TO_BCH'
          ? request.amountIn >= 80_000_000n
          : request.amountIn >= 8_000n);
      if (isBetaOverLiquidity) {
        return jsonResponse(
          {
            reason: 'INSUFFICIENT_LIQUIDITY',
            maxAmount: '75.00',
            asset: request.direction === 'EVM_TO_BCH' ? request.token : 'USDC',
            message: 'Beta solver inventory capacity reached for this route',
          },
          400,
        );
      }

      // Check max limit (10000 USD limit)
      const isOverMax =
        request.direction === 'EVM_TO_BCH'
          ? request.amountIn > 10_000_000_000n
          : request.amountIn > 1_000_000n;

      if (isOverMax) {
        const assetName =
          request.direction === 'EVM_TO_BCH' ? 'USDC' : request.token;
        return jsonResponse(
          {
            reason: 'OVER_MAX_SWAP',
            maxAmount: '10000.00',
            asset: assetName,
            message: `Swap exceeds the 10000.00 ${assetName} maximum; try 10000.00 or less`,
          },
          400,
        );
      }

      // Check liquidity limit (5000 USD limit)
      const isOverLiquidity =
        request.direction === 'EVM_TO_BCH'
          ? request.amountIn > 5_000_000_000n
          : request.amountIn > 500_000n;

      if (isOverLiquidity) {
        const assetName =
          request.direction === 'EVM_TO_BCH' ? request.token : 'USDC';
        return jsonResponse(
          {
            reason: 'INSUFFICIENT_LIQUIDITY',
            maxAmount: '5000.00',
            asset: assetName,
            message: `Only 5000.00 ${assetName} available; try 5000.00 or less`,
          },
          400,
        );
      }

      const spreadBps = isBeta ? 55 : 40; // Alpha is 40 bps, Beta is 55 bps

      let evmAmount: bigint;
      let bchTokenAmount: bigint;

      const pricing = {
        refs: [
          {
            asset: request.token,
            usdPrice: '0.998',
            source: 'cauldron',
            asOf: now,
          },
          {
            asset: 'USDC',
            usdPrice: '1.000',
            source: 'chainlink:base:usdc-usd',
            asOf: now,
          },
        ],
        spreadBps,
        fixedFeeBase: 0n,
        rounding: 'floor' as const,
      };

      if (request.direction === 'EVM_TO_BCH') {
        evmAmount = request.amountIn;
        bchTokenAmount = quoteOut(evmAmount, 6, 2, pricing);
      } else {
        bchTokenAmount = request.amountIn;
        evmAmount = quoteOut(bchTokenAmount, 2, 6, pricing);
      }

      const terms: OrderTerms = {
        version: 1,
        direction: request.direction,
        bchToken: request.token,
        bchTokenCategory:
          '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
        bchTokenAmount,
        evmAmount,
        evmToken: request.evmToken,
        evmChainId: request.chainId,
        evmHtlc: '0x5a0c062f4b7b8ff2263530e12bc15de9c836a641',
        userEvmAddress: request.userEvmAddress,
        userBchLockingBytecode: request.userBchLockingBytecode,
        solverEvmAddress: mockAccount.address,
        solverBchLockingBytecode:
          '0x76a914333333333333333333333333333333333333333388ac',
        hashLock: request.hashLock,
        evmDeadline:
          request.direction === 'EVM_TO_BCH' ? now + 24 * 3600 : now + 6 * 3600,
        bchRefundHeight:
          request.direction === 'EVM_TO_BCH' ? 170000 + 36 : 170000 + 108,
        bchCarrySats: 2000n,
        bchMaxFee: 1000n,
        quoteId: `q-${Date.now()}-${isBeta ? 'beta' : 'alpha'}`,
        quoteExpiry: now + 300,
        pricing,
      };

      const orderIdHex = computeOrderId(terms);
      const signature = await signOrderId(orderIdHex, mockAccount);

      const quoteResponse = {
        orderId: orderIdHex,
        terms,
        signature,
        signerAddress: mockAccount.address,
      };

      return jsonResponse(quoteResponse);
    }

    // 8. Order Status (GET /v1/orders/:id)
    const orderMatch = pathname.match(/^\/v1\/orders\/([^/]+)$/);
    if (orderMatch && method === 'GET') {
      const orderId = orderMatch[1]!;
      const existing = storedOrders.get(orderId);
      if (existing) {
        return jsonResponse(existing);
      }
      const genericOrder: OrderStatusResponse = {
        orderId: (orderId.startsWith('0x') && orderId.length === 66
          ? orderId
          : '0x1111111111111111111111111111111111111111111111111111111111111101') as Hex32,
        state: 'QUOTED',
        direction: 'EVM_TO_BCH',
        txids: {
          evmLock:
            '0xaaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
        },
        quoteExpiry: now + 300,
        counterDeadline: now + 3600,
        bchRefundHeight: 170072,
        updatedAt: now,
      };
      return jsonResponse(genericOrder);
    }

    // 9. Reveal Secret (POST /v1/orders/:id/secret)
    const secretMatch = pathname.match(/^\/v1\/orders\/([^/]+)\/secret$/);
    if (secretMatch && method === 'POST') {
      const orderId = secretMatch[1]!;
      return jsonResponse({
        ok: true,
        orderId: (orderId.startsWith('0x') && orderId.length === 66
          ? orderId
          : '0x1111111111111111111111111111111111111111111111111111111111111101') as Hex32,
        state: 'DONE',
        updatedAt: now,
      });
    }

    // 10. Relay Lock (POST /v1/orders/:id/relay-lock)
    const relayLockMatch = pathname.match(
      /^\/v1\/orders\/([^/]+)\/relay-lock$/,
    );
    if (relayLockMatch && method === 'POST') {
      const orderId = relayLockMatch[1]!;
      return jsonResponse({
        ok: true,
        orderId: (orderId.startsWith('0x') && orderId.length === 66
          ? orderId
          : '0x1111111111111111111111111111111111111111111111111111111111111101') as Hex32,
        txHash:
          '0xmocklock11111111111111111111111111111111111111111111111111111111' as Hex32,
        updatedAt: now,
      });
    }

    // 11. Relay Claim (POST /v1/orders/:id/relay-claim)
    const relayClaimMatch = pathname.match(
      /^\/v1\/orders\/([^/]+)\/relay-claim$/,
    );
    if (relayClaimMatch && method === 'POST') {
      const orderId = relayClaimMatch[1]!;
      return jsonResponse({
        ok: true,
        orderId: (orderId.startsWith('0x') && orderId.length === 66
          ? orderId
          : '0x1111111111111111111111111111111111111111111111111111111111111101') as Hex32,
        txHash:
          '0xmockclaim1111111111111111111111111111111111111111111111111111111' as Hex32,
        updatedAt: now,
      });
    }

    // 12. Pay Links (POST /v1/pay-links, GET /v1/pay-links/:id)
    if (pathname === '/v1/pay-links' && method === 'POST') {
      const id = `pl-${Date.now()}`;
      const link = {
        id,
        kind: 'invoice',
        status: 'open',
        token: 'PUSD',
        recipientAddress: 'bchtest:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
        recipientLockingBytecode:
          '0x76a914111111111111111111111111111111111111111188ac',
        createdAt: now,
        verified: true,
      };
      payLinks.set(id, link);
      return jsonResponse({ ok: true, link });
    }

    const payLinkMatch = pathname.match(/^\/v1\/pay-links\/([^/]+)$/);
    if (payLinkMatch && method === 'GET') {
      const id = payLinkMatch[1]!;
      const link = payLinks.get(id) ?? {
        id,
        kind: 'invoice',
        status: 'open',
        token: 'PUSD',
        recipientAddress: 'bchtest:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
        recipientLockingBytecode:
          '0x76a914111111111111111111111111111111111111111188ac',
        createdAt: now,
        verified: true,
      };
      return jsonResponse({ link });
    }

    // Fallback 404
    return jsonResponse(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Mock solver endpoint not found: ${method} ${pathname}`,
        },
      },
      404,
    );
  };

  return {
    fetch: fetchHandler,
    signerAddress: mockAccount.address,
    ephemeralKey,
  };
}

export const defaultMockServer = createMockSolverFetch();
