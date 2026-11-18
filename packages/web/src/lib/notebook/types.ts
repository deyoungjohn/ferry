import type { SendLinkData } from '../paylink/link';

export interface NotebookKdfConfig {
  readonly name: 'PBKDF2-SHA256';
  readonly iterations: number;
  readonly salt: string; // hex
}

export interface NotebookCipherConfig {
  readonly name: 'AES-256-GCM';
  readonly iv: string; // hex
}

export interface EncryptedNotebookFile {
  readonly version: 1;
  readonly kdf: NotebookKdfConfig;
  readonly cipher: NotebookCipherConfig;
  readonly data: string; // hex-encoded ciphertext
}

export interface NotebookPlaintext {
  readonly version: 1;
  readonly viewKey: string; // 32-byte hex string
  readonly links: SendLinkData[];
  readonly exportedAt: number; // Unix timestamp ms
}

export interface ExportNotebookOptions {
  readonly links: SendLinkData[];
  readonly passphrase: string;
  readonly viewKey?: string | undefined;
  readonly iterations?: number | undefined;
}

export interface ImportNotebookOptions {
  readonly json: string;
  readonly passphrase: string;
}

export interface ImportNotebookResult {
  readonly viewKey: string;
  readonly links: SendLinkData[];
  readonly importedCount: number;
}
