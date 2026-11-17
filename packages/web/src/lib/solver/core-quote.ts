import { cashAddressToLockingBytecode, type Hex32 } from '@ferry/core';
import type { QuoteRequest as CoreQuoteRequest } from '@ferry/core/api';
import { sha256, toHex } from 'viem';
import chainsData from '../../../../chain-config/src/data/chains.json';
import { NETWORK_PROFILE } from '../config';
import type { QuoteRequest } from './types';

const BCH_DECIMALS = 2;
/** Placeholder identities for quotes nobody will lock against (route tests). */
const PLACEHOLDER_EVM = '0x000000000000000000000000000000000000dEaD' as const;
const PLACEHOLDER_BCH_LOCKING = `0x76a914${'11'.repeat(20)}88ac` as const;

interface TokenFact {
  symbol: string;
  address: string | null;
  decimals: number | null;
}

interface ChainsJson {
  chains: Record<string, { mainnet: { chainId: number; tokens: TokenFact[] } }>;
}

export interface FarTokenFacts {
  readonly chainId: number;
  readonly address: `0x${string}`;
  readonly decimals: number;
}

/** Token facts for a far-chain route, from the bundled chain facts. */
export function farTokenFacts(
  chainName: string,
  symbol: string,
): FarTokenFacts | null {
  const chain = NETWORK_PROFILE.farChains.find((c) => c.name === chainName);
  const key = chain?.chainKey;
  if (!key) return null;
  const entry = (chainsData as unknown as ChainsJson).chains[key]?.mainnet;
  const token = entry?.tokens.find(
    (t) => t.symbol.toUpperCase() === symbol.toUpperCase(),
  );
  if (!entry || !token?.address || token.decimals === null) return null;
  return {
    chainId: entry.chainId,
    address: token.address as `0x${string}`,
    decimals: token.decimals,
  };
}

function toBase(amount: number, decimals: number): bigint {
  return (
    BigInt(Math.max(1, Math.round(amount * 10 ** Math.min(decimals, 8)))) *
    10n ** BigInt(Math.max(0, decimals - 8))
  );
}

function lockingBytecodeFor(address: string | undefined): `0x${string}` {
  if (!address) return PLACEHOLDER_BCH_LOCKING;
  try {
    return cashAddressToLockingBytecode(address) as `0x${string}`;
  } catch {
    return PLACEHOLDER_BCH_LOCKING;
  }
}

export interface BuiltCoreQuote {
  readonly request: CoreQuoteRequest;
  readonly secret: Hex32;
  readonly farToken: FarTokenFacts;
}

/** The request the real solver expects, built from what the swap form knows. */
export function buildCoreQuoteRequest(
  req: QuoteRequest,
): BuiltCoreQuote | null {
  const reverse = req.fromChain === NETWORK_PROFILE.bch.name;
  const farChainName = reverse ? req.toChain : req.fromChain;
  const farSymbol = reverse ? req.toToken : req.fromToken;
  const bchSymbol = (reverse ? req.fromToken : req.toToken).replace(/^t/, '');
  const far = farTokenFacts(farChainName, farSymbol);
  if (!far || (bchSymbol !== 'PUSD' && bchSymbol !== 'MUSD')) return null;

  // A fresh secret per quote; the hash lock is its SHA-256.
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = toHex(bytes) as Hex32;
  const hashLock = sha256(bytes) as Hex32;

  const request: CoreQuoteRequest = {
    direction: reverse ? 'BCH_TO_EVM' : 'EVM_TO_BCH',
    token: bchSymbol,
    chainId: far.chainId,
    evmToken: far.address,
    amountIn: toBase(req.fromAmount, reverse ? BCH_DECIMALS : far.decimals),
    userEvmAddress: (reverse
      ? (req.recipientAddress ?? req.userAddress)
      : (req.userAddress ?? req.recipientAddress)) as `0x${string}`,
    userBchLockingBytecode: reverse
      ? lockingBytecodeFor(req.userAddress)
      : lockingBytecodeFor(req.recipientAddress),
    hashLock,
    lane: req.lane,
  } as CoreQuoteRequest;
  if (!request.userEvmAddress?.startsWith('0x')) {
    (request as { userEvmAddress: `0x${string}` }).userEvmAddress =
      PLACEHOLDER_EVM;
  }
  return { request, secret, farToken: far };
}
