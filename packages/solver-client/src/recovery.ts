import {
  buildRecoveryFile,
  recoveryFileName,
  serializeRecoveryFile,
  type Hex,
  type Hex32,
  type RecoveryFile,
  type RecoveryTerms,
} from '@ferry/core';

export interface PrepareRecoveryDownloadInput {
  readonly quote: {
    readonly orderId: Hex32;
    readonly terms: RecoveryTerms;
    readonly signature: Hex;
  };
  readonly contracts: RecoveryFile['contracts'];
  readonly secret?: Hex32;
  readonly createdAt?: number;
}

export interface RecoveryDownloadPayload {
  readonly filename: string;
  readonly json: string;
  readonly mimeType: 'application/json';
  readonly file: RecoveryFile;
}

export interface DownloadAnchorLike {
  href: string;
  download: string;
  click(): void;
  remove?(): void;
}

export interface DownloadDocumentLike {
  createElement(tagName: 'a'): DownloadAnchorLike;
  body?: { appendChild(node: DownloadAnchorLike): void } | null;
}

export function prepareRecoveryDownload(
  input: PrepareRecoveryDownloadInput,
): RecoveryDownloadPayload {
  const file = buildRecoveryFile({
    orderId: input.quote.orderId,
    terms: input.quote.terms,
    solverSignature: input.quote.signature,
    contracts: input.contracts,
    ...(input.secret !== undefined ? { secret: input.secret } : {}),
    ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
  });
  return {
    filename: recoveryFileName(file.orderId),
    json: serializeRecoveryFile(file),
    mimeType: 'application/json',
    file,
  };
}

export function triggerRecoveryDownload(
  payload: RecoveryDownloadPayload,
  doc?: DownloadDocumentLike,
): boolean {
  const targetDoc =
    doc ??
    (typeof globalThis !== 'undefined' && 'document' in globalThis
      ? (globalThis as unknown as { document?: DownloadDocumentLike }).document
      : undefined);
  if (
    targetDoc === undefined ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof Blob === 'undefined'
  ) {
    return false;
  }

  const blob = new Blob([payload.json], { type: payload.mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = targetDoc.createElement('a');
  anchor.href = objectUrl;
  anchor.download = payload.filename;
  targetDoc.body?.appendChild(anchor);
  anchor.click();
  anchor.remove?.();
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(objectUrl);
  }
  return true;
}
