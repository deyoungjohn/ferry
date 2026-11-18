import { describe, expect, it } from 'vitest';
import { keccak256, type Hex } from 'viem';
import {
  DeploymentRecordError,
  loadChainData,
  parseChainConfigData,
  predictHtlcAddress,
  recordDeployment,
  type ChainConfigData,
  type DeploymentArtifact,
  type DeploymentClient,
} from '../src/index.js';

const CODE: Hex = '0x6001600055';
const ARTIFACT: DeploymentArtifact = {
  deployedBytecode: { object: CODE },
};
const PREDICTED = predictHtlcAddress();

function data(): ChainConfigData {
  // The shipped data already records the real Base deployment; start from a clean slate.
  const clean = parseChainConfigData(loadChainData());
  clean.chains.base.mainnet.deployment.htlcAddress = null;
  clean.chains.base.mainnet.deployment.deployBlock = null;
  return clean;
}

function clientAt(blocks: Record<number, Hex>): DeploymentClient {
  return {
    async getCode({ blockNumber }) {
      return blocks[Number(blockNumber)] ?? '0x';
    },
  };
}

function baseOptions() {
  return {
    chain: 'base' as const,
    address: PREDICTED,
    block: 500,
    client: clientAt({ 500: CODE }),
    artifact: ARTIFACT,
    data: data(),
  };
}

describe('recordDeployment', () => {
  it('records the address and block only when the prediction, code hash and block match', async () => {
    const original = data();
    const result = await recordDeployment(baseOptions());
    const deployment = result.data.chains.base.mainnet.deployment;
    expect(deployment.htlcAddress).toBe(PREDICTED);
    expect(deployment.deployBlock).toBe(500);
    expect(result.diff).toContain('htlcAddress: null ->');
    expect(result.diff).toContain('deployBlock: null -> 500');
    expect(result.codeHash).toBe(keccak256(CODE));
    expect(result.artifactHash).toBe(keccak256(CODE));

    const expected = structuredClone(original);
    expected.chains.base.mainnet.deployment.htlcAddress = PREDICTED;
    expected.chains.base.mainnet.deployment.deployBlock = 500;
    expect(result.data).toEqual(expected);
  });

  it('rejects a wrong address before reading the chain', async () => {
    await expect(
      recordDeployment({
        ...baseOptions(),
        address: '0x0000000000000000000000000000000000000001',
      }),
    ).rejects.toThrow(/CREATE2 prediction/);
  });

  it('rejects empty code at the deploy block', async () => {
    await expect(
      recordDeployment({ ...baseOptions(), client: clientAt({}) }),
    ).rejects.toThrow(/No contract code/);
  });

  it('rejects a code hash that differs from the artifact', async () => {
    await expect(
      recordDeployment({
        ...baseOptions(),
        client: clientAt({ 500: '0x6002600055' }),
      }),
    ).rejects.toThrow(/does not match the build artifact/);
  });

  it('accepts on-chain code that differs only in the immutable slots', async () => {
    // Artifact has zeros in bytes 2..3 (an immutable slot); the chain holds the real values.
    const artifactCode: Hex = '0x60000000aa55';
    const onChain: Hex = '0x6000beefaa55';
    const result = await recordDeployment({
      ...baseOptions(),
      client: clientAt({ 500: onChain }),
      artifact: {
        deployedBytecode: {
          object: artifactCode,
          immutableReferences: [{ start: 2, length: 2 }],
        },
      },
    });
    expect(result.data.chains.base.mainnet.deployment.deployBlock).toBe(500);
  });

  it('rejects a difference outside the immutable slots', async () => {
    await expect(
      recordDeployment({
        ...baseOptions(),
        client: clientAt({ 500: '0x6000beef0055' }),
        artifact: {
          deployedBytecode: {
            object: '0x60000000aa55',
            immutableReferences: [{ start: 2, length: 2 }],
          },
        },
      }),
    ).rejects.toThrow(/does not match the build artifact/);
  });

  it('rejects a block where code already existed', async () => {
    await expect(
      recordDeployment({
        ...baseOptions(),
        client: clientAt({ 499: CODE, 500: CODE }),
      }),
    ).rejects.toThrow(/Code already existed/);
  });

  it('rejects a missing build artifact', async () => {
    await expect(
      recordDeployment({ ...baseOptions(), artifact: null }),
    ).rejects.toThrow(/artifact is missing/);
  });

  it('refuses a testnet', async () => {
    await expect(
      recordDeployment({ ...baseOptions(), network: 'testnet' }),
    ).rejects.toThrow(DeploymentRecordError);
  });

  it('refuses to overwrite a different recorded address', async () => {
    const withOther = data();
    withOther.chains.base.mainnet.deployment.htlcAddress =
      '0x0000000000000000000000000000000000000001';
    await expect(
      recordDeployment({ ...baseOptions(), data: withOther }),
    ).rejects.toThrow(/different HTLC address/);
  });
});
