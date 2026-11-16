import { describe, expect, it } from 'vitest';
import { decodeCashAddress } from '@ferry/core';
import {
  KNOWN_DEV_EVM_KEYS,
  classifyAccountCode,
  decodeWif,
  deriveBchAddressesFromWif,
  deriveEvmAddress,
  generateKeyMaterial,
  isBchMainnetWif,
  isEvmPrivateKey,
  knownTestKeyReason,
  type RandomSource,
} from '../src/key-material.js';
import {
  buildKeyFile,
  checkKeyFile,
  evidenceBlock,
  parseKeyFile,
} from '../src/key-file.js';

function bytes(seed: number): Uint8Array {
  return Uint8Array.from(
    { length: 32 },
    (_, index) => (index * 7 + seed) & 0xff,
  );
}

function sequence(values: Uint8Array[]): RandomSource {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error('random source exhausted');
    return value;
  };
}

const material = generateKeyMaterial(sequence([bytes(1), bytes(2), bytes(3)]));

describe('key material', () => {
  it('generates three distinct keys and public mainnet addresses', () => {
    expect(material.deployerEvmPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(material.solverEvmPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(material.solverBchWif).toMatch(/^[KL]/);
    expect(material.deployerEvmPrivateKey).not.toBe(
      material.solverEvmPrivateKey,
    );
    expect(material.addresses.deployerEvm).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(material.addresses.solverBch.tokenAware).toMatch(/^bitcoincash:z/);
    expect(material.addresses.solverBch.plain).toMatch(/^bitcoincash:q/);

    const tokenAddress = decodeCashAddress(
      material.addresses.solverBch.tokenAware,
    );
    const plainAddress = decodeCashAddress(material.addresses.solverBch.plain);
    expect(tokenAddress.tokenAware).toBe(true);
    expect(plainAddress.tokenAware).toBe(false);
    expect(tokenAddress.lockingBytecode).toBe(plainAddress.lockingBytecode);
  });

  it('round-trips the generated WIF', () => {
    const decoded = decodeWif(material.solverBchWif);
    expect(decoded?.mainnet).toBe(true);
    expect(decoded?.compressed).toBe(true);
    expect(isBchMainnetWif(material.solverBchWif)).toBe(true);
    expect(deriveBchAddressesFromWif(material.solverBchWif)).toEqual(
      material.addresses.solverBch,
    );
  });

  it('rejects an invalid key and a known development key', () => {
    expect(isEvmPrivateKey('0x1234')).toBe(false);
    expect(isEvmPrivateKey(KNOWN_DEV_EVM_KEYS[0]!)).toBe(true);
    expect(knownTestKeyReason(KNOWN_DEV_EVM_KEYS[0]!)).toContain('development');
    expect(knownTestKeyReason(`0x${'11'.repeat(32)}`)).toContain('repeating');
    expect(knownTestKeyReason(material.deployerEvmPrivateKey)).toBeNull();
    expect(deriveEvmAddress(material.deployerEvmPrivateKey)).toBe(
      material.addresses.deployerEvm,
    );
  });

  it('classifies empty, delegated and ordinary account code', () => {
    expect(classifyAccountCode('0x')).toBe('empty');
    expect(classifyAccountCode('')).toBe('empty');
    expect(classifyAccountCode('0xef0100' + '00'.repeat(20))).toBe('delegated');
    expect(classifyAccountCode('0x6001600055')).toBe('code');
  });
});

describe('key file', () => {
  const content = buildKeyFile(material, new Date(0));

  it('parses the generated public address comments and key names', () => {
    const parsed = parseKeyFile(content);
    expect(parsed.recorded.get('DEPLOYER_EVM_ADDRESS')).toBe(
      material.addresses.deployerEvm,
    );
    expect(parsed.values.get('SOLVER_BCH_WIF')).toBe(material.solverBchWif);
    expect(parsed.duplicates).toEqual([]);
  });

  it('passes a correct 0600 file and rejects a loose mode', () => {
    expect(checkKeyFile(content, 0o600).ok).toBe(true);
    const loose = checkKeyFile(content, 0o644);
    expect(loose.ok).toBe(false);
    expect(
      loose.checks.find((item) => item.name === 'file mode 0600')?.ok,
    ).toBe(false);
  });

  it('rejects an address comment that does not match the key', () => {
    const tampered = content.replace(
      /# DEPLOYER_EVM_ADDRESS=.*/,
      '# DEPLOYER_EVM_ADDRESS=0x0000000000000000000000000000000000000001',
    );
    const result = checkKeyFile(tampered, 0o600);
    expect(result.ok).toBe(false);
    expect(
      result.checks.find(
        (item) => item.name === 'DEPLOYER_EVM_ADDRESS matches key',
      )?.ok,
    ).toBe(false);
  });

  it('rejects duplicate keys and known development keys', () => {
    const duplicate = checkKeyFile(
      buildKeyFile(
        {
          ...material,
          solverEvmPrivateKey: material.deployerEvmPrivateKey,
          addresses: {
            ...material.addresses,
            solverEvm: material.addresses.deployerEvm,
          },
        },
        new Date(0),
      ),
      0o600,
    );
    expect(duplicate.ok).toBe(false);
    expect(
      duplicate.checks.find(
        (item) => item.name === 'deployer and solver EVM keys differ',
      )?.ok,
    ).toBe(false);

    const knownKey = KNOWN_DEV_EVM_KEYS[0]!;
    const known = checkKeyFile(
      buildKeyFile(
        {
          ...material,
          deployerEvmPrivateKey: knownKey,
          addresses: {
            ...material.addresses,
            deployerEvm: deriveEvmAddress(knownKey),
          },
        },
        new Date(0),
      ),
      0o600,
    );
    expect(known.ok).toBe(false);
    expect(
      known.checks.find((item) => item.name === 'no known test keys')?.ok,
    ).toBe(false);
  });

  it('prints an evidence block with addresses only', () => {
    const block = evidenceBlock(material.addresses);
    expect(block).toContain(material.addresses.deployerEvm);
    expect(block).toContain(material.addresses.solverBch.tokenAware);
    expect(block).not.toContain(material.deployerEvmPrivateKey);
    expect(block).not.toContain(material.solverBchWif);
  });
});
