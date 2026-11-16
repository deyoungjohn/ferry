import { describe, expect, it } from 'vitest';
import { EvmChainConfigSchema } from '@ferry/core';
import {
  DeploymentAddressError,
  PREDICTED_FERRY_HTLC_ADDRESS,
  loadChainConfig,
  loadChainData,
  type ChainConfigData,
} from '../src/index.js';

function data(): ChainConfigData {
  return structuredClone(loadChainData()) as ChainConfigData;
}

describe('core EvmChainConfig shape', () => {
  it('returns chain objects that parse with core EvmChainConfigSchema', () => {
    for (const chain of loadChainConfig({ env: {} }).chains) {
      expect(EvmChainConfigSchema.safeParse(chain).success).toBe(true);
    }
  });

  it('keeps deployBlock out of the output until a deployment sets it', () => {
    const base = loadChainConfig({ env: {} }).chains.find(
      (chain) => chain.id === 'base',
    );
    expect(base).toBeDefined();
    expect(base?.deployBlock).toBeUndefined();
    expect(EvmChainConfigSchema.safeParse(base).success).toBe(true);
  });

  it('accepts an optional deployBlock from the deployment facts', () => {
    const facts = data();
    facts.chains.base.mainnet.deployment.deployBlock = 57937206;
    const loaded = loadChainConfig({ data: facts, env: {} });
    const base = loaded.chains.find((chain) => chain.id === 'base');
    expect(base?.deployBlock).toBe(57937206);
    expect(EvmChainConfigSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a non-positive deployBlock through the strict core schema', () => {
    const facts = data();
    facts.chains.base.mainnet.deployment.deployBlock = 0;
    expect(() => loadChainConfig({ data: facts, env: {} })).toThrow();
  });

  it('accepts a configured HTLC address that matches the CREATE2 prediction', () => {
    const facts = data();
    facts.chains.base.mainnet.deployment.htlcAddress =
      PREDICTED_FERRY_HTLC_ADDRESS;
    const loaded = loadChainConfig({ data: facts, env: {} });
    expect(
      loaded.chains.find((chain) => chain.id === 'base')?.htlcAddress,
    ).toBe(PREDICTED_FERRY_HTLC_ADDRESS);
  });

  it('rejects a configured HTLC address that does not match the prediction', () => {
    const facts = data();
    facts.chains.base.mainnet.deployment.htlcAddress =
      '0x0000000000000000000000000000000000000001';
    expect(() => loadChainConfig({ data: facts, env: {} })).toThrow(
      DeploymentAddressError,
    );
  });
});
