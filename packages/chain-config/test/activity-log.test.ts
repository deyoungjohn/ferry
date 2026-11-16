import { describe, expect, it } from 'vitest';
import {
  ActivityReadUnavailableError,
  activityLogCapability,
  loadChainConfig,
  selectActivityLogEndpoint,
} from '../src/index.js';

const fakePaid = 'https://paid.example.com/v1/SECRET_KEY';

describe('activity log capability', () => {
  it('skips a tiny paid endpoint and selects the public fallback', () => {
    const config = loadChainConfig({
      env: { RPC_URL_ARC: fakePaid },
      rpcCaps: { [fakePaid]: 10 },
    });
    const arc = config.facts.find((item) => item.id === 'arc')!;
    expect(arc.activityLog.available).toBe(true);
    expect(arc.activityLog.minRange).toBe(1_000);
    expect(selectActivityLogEndpoint(arc).host).toBe('rpc.mainnet.arc.io');
  });

  it('fails closed when every endpoint has a tiny cap', () => {
    const config = loadChainConfig({
      env: { RPC_URL_ARC: fakePaid },
      rpcCaps: { [fakePaid]: 10 },
    });
    const arc = structuredClone(
      config.facts.find((item) => item.id === 'arc')!,
    );
    arc.rpcEndpoints = arc.rpcEndpoints.map((endpoint) => ({
      ...endpoint,
      maxLogRange: 10,
    }));
    arc.activityLog = activityLogCapability(arc.rpcEndpoints);
    expect(arc.activityLog.available).toBe(false);
    try {
      selectActivityLogEndpoint(arc);
    } catch (error) {
      expect(error).toBeInstanceOf(ActivityReadUnavailableError);
      expect(String(error)).not.toContain('SECRET_KEY');
      expect(String(error)).not.toContain('/v1/');
      return;
    }
    throw new Error('expected selectActivityLogEndpoint to throw');
  });
});
