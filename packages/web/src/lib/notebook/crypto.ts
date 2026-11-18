import type {
  EncryptedNotebookFile,
  ExportNotebookOptions,
  ImportNotebookOptions,
  NotebookPlaintext,
} from './types';

export const MIN_PBKDF2_ITERATIONS = 600_000;
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(rawHex: string): Uint8Array {
  const clean = rawHex.startsWith('0x') ? rawHex.slice(2) : rawHex;
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.substring(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(
        `Invalid hex byte at index ${i}: ${clean.substring(i, i + 2)}`,
      );
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}

/**
 * Generates a random 32-byte view key (64 hex characters with 0x prefix).
 */
export function generateViewKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${bytesToHex(bytes)}`;
}

/**
 * Returns a filename for exported notebooks: ferry-send-links-<date>.json
 */
export function getNotebookFilename(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `ferry-send-links-${yyyy}-${mm}-${dd}.json`;
}

/**
 * Derives an AES-GCM-256 key from a passphrase using Web Crypto PBKDF2 with SHA-256.
 */
async function deriveEncryptionKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    usages,
  );
}

/**
 * Exports send links and a 32-byte viewKey into an encrypted notebook file.
 * Uses only Web Crypto (PBKDF2-SHA256 with >=600,000 iterations and fresh random salt, AES-256-GCM with fresh random IV).
 */
export async function exportNotebook(
  options: ExportNotebookOptions,
): Promise<EncryptedNotebookFile> {
  if (!options.passphrase || options.passphrase.trim() === '') {
    throw new Error('Passphrase cannot be empty.');
  }

  const iterations = Math.max(
    options.iterations ?? DEFAULT_PBKDF2_ITERATIONS,
    MIN_PBKDF2_ITERATIONS,
  );

  // Generate fresh random salt (16 bytes) and fresh random IV (12 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const viewKey = options.viewKey ?? generateViewKey();
  const plaintextPayload: NotebookPlaintext = {
    version: 1,
    viewKey,
    links: options.links,
    exportedAt: Date.now(),
  };

  const derivedKey = await deriveEncryptionKey(
    options.passphrase,
    salt,
    iterations,
    ['encrypt'],
  );

  const enc = new TextEncoder();
  const encodedPlaintext = enc.encode(JSON.stringify(plaintextPayload));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    derivedKey,
    encodedPlaintext,
  );

  return {
    version: 1,
    kdf: {
      name: 'PBKDF2-SHA256',
      iterations,
      salt: bytesToHex(salt),
    },
    cipher: {
      name: 'AES-256-GCM',
      iv: bytesToHex(iv),
    },
    data: bytesToHex(new Uint8Array(ciphertextBuffer)),
  };
}

/**
 * Decrypts and imports an encrypted notebook file.
 * If passphrase is wrong or file is corrupted, throws a plain-words error without mutating state.
 */
export async function importNotebook(
  options: ImportNotebookOptions,
): Promise<NotebookPlaintext> {
  if (!options.passphrase || options.passphrase.trim() === '') {
    throw new Error('Passphrase cannot be empty.');
  }

  let file: EncryptedNotebookFile;
  try {
    file = JSON.parse(options.json) as EncryptedNotebookFile;
  } catch (cause) {
    throw new Error('Damaged notebook file: not a valid JSON document.', {
      cause,
    });
  }

  if (
    !file ||
    typeof file !== 'object' ||
    file.version !== 1 ||
    !file.kdf ||
    file.kdf.name !== 'PBKDF2-SHA256' ||
    typeof file.kdf.iterations !== 'number' ||
    typeof file.kdf.salt !== 'string' ||
    !file.cipher ||
    file.cipher.name !== 'AES-256-GCM' ||
    typeof file.cipher.iv !== 'string' ||
    typeof file.data !== 'string'
  ) {
    throw new Error(
      'Damaged notebook file: invalid format or missing cryptographic parameters.',
    );
  }

  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = hexToBytes(file.kdf.salt);
    iv = hexToBytes(file.cipher.iv);
    ciphertext = hexToBytes(file.data);
  } catch (cause) {
    throw new Error('Damaged notebook file: invalid hex-encoded data.', {
      cause,
    });
  }

  let derivedKey: CryptoKey;
  try {
    derivedKey = await deriveEncryptionKey(
      options.passphrase,
      salt,
      file.kdf.iterations,
      ['decrypt'],
    );
  } catch (cause) {
    throw new Error('Failed to derive decryption key.', { cause });
  }

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
      },
      derivedKey,
      ciphertext as unknown as BufferSource,
    );
  } catch (cause) {
    // Web Crypto throws OperationError if decryption or authentication tag fails
    throw new Error('Incorrect passphrase or damaged notebook file.', {
      cause,
    });
  }

  const dec = new TextDecoder();
  const plaintextStr = dec.decode(decryptedBuffer);

  let parsed: NotebookPlaintext;
  try {
    parsed = JSON.parse(plaintextStr) as NotebookPlaintext;
  } catch (cause) {
    throw new Error(
      'Damaged notebook file: decrypted content is not valid JSON.',
      {
        cause,
      },
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray(parsed.links) ||
    typeof parsed.viewKey !== 'string'
  ) {
    throw new Error(
      'Damaged notebook file: decrypted structure is missing links or viewKey.',
    );
  }

  return parsed;
}
