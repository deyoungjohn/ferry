import { describe, expect, it } from 'vitest';
import {
  exportNotebook,
  getNotebookFilename,
  importNotebook,
  generateViewKey,
  MIN_PBKDF2_ITERATIONS,
} from '../lib/notebook/crypto';
import { mergeSendLinks, getLinkStatusRank } from '../lib/notebook/merge';
import type { SendLinkData } from '../lib/paylink/link';

describe('Encrypted Notebook Cryptography & Merging (B3-15)', () => {
  const sampleSecret =
    '0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
  const sampleOrderId =
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  const sampleLinks: SendLinkData[] = [
    {
      id: sampleOrderId,
      orderId: sampleOrderId,
      destinationChain: 'Base',
      destinationToken: 'USDC',
      recipientEvmAddress: '0x1234567890123456789012345678901234567890',
      amount: 50.0,
      windowSeconds: 86400,
      expiresAt: 1780000000,
      note: 'Birthday gift',
      status: 'open',
      lockStatus: 'locked',
      createdAt: 1700000000,
      secret: sampleSecret,
      refundDate: 'Tomorrow (BCH block 900000)',
      txId: 'bch-tx-111',
      recoveryJson: '{"version":1}',
    },
    {
      id: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      orderId:
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      destinationChain: 'Arbitrum',
      destinationToken: 'USDC',
      recipientEvmAddress: '0x2222222222222222222222222222222222222222',
      amount: 25.0,
      windowSeconds: 3600,
      expiresAt: 1780003600,
      note: 'Dinner split',
      status: 'open',
      lockStatus: 'pending_lock',
      createdAt: 1700001000,
      secret:
        '0x9999999999999999999999999999999999999999999999999999999999999999',
    },
  ];

  it('1. Round trip: exports and imports successfully, preserving links and viewKey', async () => {
    const passphrase = 'correct horse battery staple';
    const viewKey = generateViewKey();

    // Export notebook with lower iterations in test to keep execution fast
    const exported = await exportNotebook({
      links: sampleLinks,
      passphrase,
      viewKey,
      iterations: MIN_PBKDF2_ITERATIONS,
    });

    expect(exported.version).toBe(1);
    expect(exported.kdf.name).toBe('PBKDF2-SHA256');
    expect(exported.kdf.iterations).toBeGreaterThanOrEqual(600_000);
    expect(exported.cipher.name).toBe('AES-256-GCM');
    expect(exported.cipher.iv).toMatch(/^[0-9a-f]{24}$/); // 12 bytes = 24 hex chars
    expect(exported.data).toMatch(/^[0-9a-f]+$/);

    // Import notebook with same passphrase
    const jsonString = JSON.stringify(exported);
    const imported = await importNotebook({
      json: jsonString,
      passphrase,
    });

    expect(imported.version).toBe(1);
    expect(imported.viewKey).toBe(viewKey);
    expect(imported.links).toHaveLength(2);
    expect(imported.links[0]?.id).toBe(sampleOrderId);
    expect(imported.links[0]?.secret).toBe(sampleSecret);
    expect(imported.links[0]?.note).toBe('Birthday gift');
    expect(imported.links[1]?.amount).toBe(25.0);
  });

  it('2. Safety: file contains NO plaintext secrets or sensitive data', async () => {
    const passphrase = 'strong-secret-passphrase-123';
    const exported = await exportNotebook({
      links: sampleLinks,
      passphrase,
      iterations: MIN_PBKDF2_ITERATIONS,
    });

    const fileString = JSON.stringify(exported);

    // Assert that the secrets NEVER appear anywhere in the encrypted file
    expect(fileString.includes(sampleSecret)).toBe(false);
    expect(fileString.includes(sampleSecret.slice(2))).toBe(false);
    expect(fileString.includes('Birthday gift')).toBe(false);
    expect(fileString.includes('Dinner split')).toBe(false);
    expect(fileString.includes(passphrase)).toBe(false);
  });

  it('3. Safety: tampered ciphertext, iv, or salt fails to decrypt', async () => {
    const passphrase = 'my-secret-passphrase';
    const exported = await exportNotebook({
      links: sampleLinks,
      passphrase,
      iterations: MIN_PBKDF2_ITERATIONS,
    });

    // 3a. Tampered ciphertext data
    const tamperedData = {
      ...exported,
      data:
        exported.data.slice(0, 10) +
        (exported.data[10] === 'a' ? 'b' : 'a') +
        exported.data.slice(11),
    };
    await expect(
      importNotebook({ json: JSON.stringify(tamperedData), passphrase }),
    ).rejects.toThrow(/Incorrect passphrase or damaged notebook file/i);

    // 3b. Tampered IV
    const tamperedIv = {
      ...exported,
      cipher: {
        ...exported.cipher,
        iv:
          exported.cipher.iv.slice(0, 4) +
          (exported.cipher.iv[4] === '0' ? '1' : '0') +
          exported.cipher.iv.slice(5),
      },
    };
    await expect(
      importNotebook({ json: JSON.stringify(tamperedIv), passphrase }),
    ).rejects.toThrow(/Incorrect passphrase or damaged notebook file/i);

    // 3c. Tampered Salt
    const tamperedSalt = {
      ...exported,
      kdf: {
        ...exported.kdf,
        salt:
          exported.kdf.salt.slice(0, 4) +
          (exported.kdf.salt[4] === '0' ? '1' : '0') +
          exported.kdf.salt.slice(5),
      },
    };
    await expect(
      importNotebook({ json: JSON.stringify(tamperedSalt), passphrase }),
    ).rejects.toThrow(/Incorrect passphrase or damaged notebook file/i);
  });

  it('4. Safety: wrong passphrase fails decryption and changes nothing', async () => {
    const passphrase = 'correct-passphrase';
    const exported = await exportNotebook({
      links: sampleLinks,
      passphrase,
      iterations: MIN_PBKDF2_ITERATIONS,
    });

    await expect(
      importNotebook({
        json: JSON.stringify(exported),
        passphrase: 'wrong-passphrase',
      }),
    ).rejects.toThrow(/Incorrect passphrase or damaged notebook file/i);
  });

  it('5. Safety: two exports of the same data differ (fresh random salt and iv per export)', async () => {
    const passphrase = 'same-passphrase';
    const export1 = await exportNotebook({
      links: sampleLinks,
      passphrase,
      iterations: MIN_PBKDF2_ITERATIONS,
    });
    const export2 = await exportNotebook({
      links: sampleLinks,
      passphrase,
      iterations: MIN_PBKDF2_ITERATIONS,
    });

    expect(export1.kdf.salt).not.toBe(export2.kdf.salt);
    expect(export1.cipher.iv).not.toBe(export2.cipher.iv);
    expect(export1.data).not.toBe(export2.data);
  });

  it('6. Filename format follows ferry-send-links-<date>.json', () => {
    const fixedDate = new Date(2026, 10, 18); // Nov 18 2026
    const filename = getNotebookFilename(fixedDate);
    expect(filename).toBe('ferry-send-links-2026-11-18.json');
  });

  describe('7. Merging logic (mergeSendLinks)', () => {
    it('merges by id where newer status wins and nothing is deleted', () => {
      const existing: SendLinkData[] = [
        {
          id: 'link-1',
          destinationChain: 'Base',
          destinationToken: 'USDC',
          recipientEvmAddress: '0x111',
          amount: 10,
          windowSeconds: 3600,
          expiresAt: 2000,
          status: 'open',
          lockStatus: 'pending_lock',
          createdAt: 1000,
          secret: 'secret-1',
        },
        {
          id: 'link-2',
          destinationChain: 'Base',
          destinationToken: 'USDC',
          recipientEvmAddress: '0x222',
          amount: 20,
          windowSeconds: 3600,
          expiresAt: 2000,
          status: 'open',
          lockStatus: 'locked',
          createdAt: 1050,
          secret: 'secret-2',
        },
      ];

      const incoming: SendLinkData[] = [
        // link-1 has now been locked on another device: newer status wins!
        {
          id: 'link-1',
          destinationChain: 'Base',
          destinationToken: 'USDC',
          recipientEvmAddress: '0x111',
          amount: 10,
          windowSeconds: 3600,
          expiresAt: 2000,
          status: 'open',
          lockStatus: 'locked',
          createdAt: 1000,
          txId: 'bch-tx-123',
        },
        // link-3 is a brand new link from the other device
        {
          id: 'link-3',
          destinationChain: 'Arbitrum',
          destinationToken: 'USDC',
          recipientEvmAddress: '0x333',
          amount: 30,
          windowSeconds: 3600,
          expiresAt: 2000,
          status: 'claimed',
          lockStatus: 'claimed',
          createdAt: 1100,
          secret: 'secret-3',
        },
      ];

      const merged = mergeSendLinks(existing, incoming);

      // Assert nothing is deleted (link-1, link-2, link-3 all present)
      expect(merged).toHaveLength(3);

      const mergedLink1 = merged.find((l) => l.id === 'link-1');
      expect(mergedLink1?.lockStatus).toBe('locked'); // newer status won over pending_lock!
      expect(mergedLink1?.secret).toBe('secret-1'); // preserved secret
      expect(mergedLink1?.txId).toBe('bch-tx-123'); // merged new txId

      const mergedLink2 = merged.find((l) => l.id === 'link-2');
      expect(mergedLink2?.lockStatus).toBe('locked');
      expect(mergedLink2?.secret).toBe('secret-2');

      const mergedLink3 = merged.find((l) => l.id === 'link-3');
      expect(mergedLink3?.status).toBe('claimed');
    });

    it('ranks claimed > expired > locked > pending_lock > open', () => {
      expect(getLinkStatusRank({ status: 'claimed' } as SendLinkData)).toBe(4);
      expect(getLinkStatusRank({ status: 'expired' } as SendLinkData)).toBe(3);
      expect(
        getLinkStatusRank({
          status: 'open',
          lockStatus: 'locked',
        } as SendLinkData),
      ).toBe(2);
      expect(
        getLinkStatusRank({
          status: 'open',
          lockStatus: 'pending_lock',
        } as SendLinkData),
      ).toBe(1);
      expect(getLinkStatusRank({ status: 'open' } as SendLinkData)).toBe(0);
    });
  });
});
