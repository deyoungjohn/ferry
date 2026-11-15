import type { Hex32 } from './terms.js';

const BASE58_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{16,32}$/;
const SEND_ID_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;
const SECRET_FRAGMENT_RE = /^(?:0x)?([0-9a-fA-F]{64})$/;

function normalizeHex32(value: string, label: string): Hex32 {
  const match = SECRET_FRAGMENT_RE.exec(value);
  if (!match) {
    throw new Error(`Invalid ${label}: expected 32-byte hex`);
  }
  return `0x${match[1]!.toLowerCase()}` as Hex32;
}

function normalizeSendId(id: string): string {
  if (!SEND_ID_RE.test(id)) {
    throw new Error('Invalid send-link id: expected 32-byte hex');
  }
  return id.startsWith('0x') || id.startsWith('0X')
    ? `0x${id.slice(2).toLowerCase()}`
    : id.toLowerCase();
}

function assertValidPayId(id: string): string {
  if (!BASE58_ID_RE.test(id)) {
    throw new Error('Invalid pay-link id: expected base58');
  }
  return id;
}

function joinBaseUrl(baseUrl: string, pathAndFragment: string): string {
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = '';
  const basePath = url.pathname.replace(/\/+$/, '');
  const hashIndex = pathAndFragment.indexOf('#');
  const pathPart =
    hashIndex === -1 ? pathAndFragment : pathAndFragment.slice(0, hashIndex);
  const fragmentPart =
    hashIndex === -1 ? '' : pathAndFragment.slice(hashIndex + 1);
  url.pathname = `${basePath}${pathPart}`;
  if (fragmentPart.length > 0) {
    url.hash = fragmentPart;
  }
  return url.toString();
}

export function buildPayLinkPath(id: string): string {
  return `/p/${assertValidPayId(id)}`;
}

export function buildPayLinkUrl(baseUrl: string, id: string): string {
  return joinBaseUrl(baseUrl, buildPayLinkPath(id));
}

export function parsePayLinkUrl(input: string): { kind: 'pay'; id: string } {
  const url = input.startsWith('/')
    ? new URL(input, 'https://ferry.invalid')
    : new URL(input);
  if (url.hash.length > 0 || url.search.length > 0) {
    throw new Error('Pay-link URL must not carry query parameters or fragment');
  }
  const match = /(?:^|\/)p\/([^/]+)$/.exec(url.pathname);
  if (!match) {
    throw new Error('Invalid pay-link path: expected /p/<id>');
  }
  return { kind: 'pay', id: assertValidPayId(match[1]!) };
}

/**
 * Build a send-link path `/s/<id>#<secret>`.
 * The secret is placed exclusively in the URL fragment so browsers never send it to a server.
 */
export function buildSendLinkPath(id: string, secretHex: string): string {
  const normalizedId = normalizeSendId(id);
  const normalizedSecret = normalizeHex32(secretHex, 'send-link secret');
  return `/s/${normalizedId}#${normalizedSecret}`;
}

export function buildSendLinkUrl(
  baseUrl: string,
  id: string,
  secretHex: string,
): string {
  return joinBaseUrl(baseUrl, buildSendLinkPath(id, secretHex));
}

export function parseSendLinkUrl(input: string): {
  kind: 'send';
  id: string;
  secret: Hex32;
} {
  const url = input.startsWith('/')
    ? new URL(input, 'https://ferry.invalid')
    : new URL(input);
  if (url.search.length > 0) {
    throw new Error('Send-link URL must not carry query parameters');
  }
  const match = /(?:^|\/)s\/([^/]+)$/.exec(url.pathname);
  if (!match) {
    throw new Error('Invalid send-link path: expected /s/<id>#<secret>');
  }
  const id = normalizeSendId(match[1]!);
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  if (fragment.length === 0) {
    throw new Error('Send-link URL is missing the secret fragment');
  }
  const secret = normalizeHex32(fragment, 'send-link secret');
  return { kind: 'send', id, secret };
}

/**
 * Return only the path (+ optional search) portion of a link URL, never the fragment.
 * Safe for HTTP server request paths.
 */
export function toServerRequestPath(input: string): string {
  const url = input.startsWith('/')
    ? new URL(input, 'https://ferry.invalid')
    : new URL(input);
  return `${url.pathname}${url.search}`;
}

/**
 * Strip any URL fragment before logging so a send-link secret can never appear in logs.
 */
export function redactLinkForLog(input: string): string {
  const hashIndex = input.indexOf('#');
  return hashIndex === -1 ? input : input.slice(0, hashIndex);
}
