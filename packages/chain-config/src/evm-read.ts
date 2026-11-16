import type { RpcCaller } from './rpc-overrides.js';

export const SELECTORS = {
  decimals: '0x313ce567',
  name: '0x06fdde03',
  version: '0x54fd4d50',
  domainSeparator: '0x3644e515',
  nonces: '0x7ecebe00',
  balanceOf: '0x70a08231',
  description: '0x7284e416',
  latestRoundData: '0xfeaf968c',
} as const;

export async function ethCall(
  call: RpcCaller,
  url: string,
  to: string,
  data: string,
): Promise<string> {
  return call<string>(url, 'eth_call', [{ to, data }, 'latest']);
}

export async function ethGetCode(
  call: RpcCaller,
  url: string,
  address: string,
): Promise<string> {
  return call<string>(url, 'eth_getCode', [address, 'latest']);
}

export function decodeAbiString(value: string): string {
  const body = value.startsWith('0x') ? value.slice(2) : value;
  if (body.length < 128) return '';
  const offsetBytes = Number(BigInt(`0x${body.slice(0, 64)}`));
  const lengthBytes = Number(
    BigInt(`0x${body.slice(offsetBytes * 2, offsetBytes * 2 + 64)}`),
  );
  if (lengthBytes <= 0 || lengthBytes > 4096) return '';
  const dataStart = offsetBytes * 2 + 64;
  return Buffer.from(
    body.slice(dataStart, dataStart + lengthBytes * 2),
    'hex',
  ).toString('utf8');
}

export function decodeUint(value: string): bigint {
  return BigInt(value);
}

export interface LatestRoundData {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

export function decodeLatestRoundData(value: string): LatestRoundData {
  const body = value.startsWith('0x') ? value.slice(2) : value;
  if (body.length < 320) {
    throw new Error('latestRoundData returned too few words');
  }
  const word = (index: number): bigint =>
    BigInt(`0x${body.slice(index * 64, (index + 1) * 64)}`);
  return {
    roundId: word(0),
    answer: word(1),
    startedAt: word(2),
    updatedAt: word(3),
    answeredInRound: word(4),
  };
}

export function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}
