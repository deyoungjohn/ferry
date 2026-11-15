import { describe, expect, it } from 'vitest';
import { EnabledRoutesError, parseEnabledRoutes } from '../src/index.js';

function issues(raw: string): string[] {
  try {
    parseEnabledRoutes(raw);
    return [];
  } catch (error) {
    if (error instanceof EnabledRoutesError) return error.issues;
    throw error;
  }
}

describe('parseEnabledRoutes', () => {
  it('returns an empty list for unset or blank values', () => {
    expect(parseEnabledRoutes(undefined)).toEqual([]);
    expect(parseEnabledRoutes(null)).toEqual([]);
    expect(parseEnabledRoutes('')).toEqual([]);
    expect(parseEnabledRoutes('   ')).toEqual([]);
  });

  it('parses a single route and normalizes case', () => {
    expect(parseEnabledRoutes('USDC:Base')).toEqual([
      { asset: 'USDC', chain: 'base', key: 'usdc:base' },
    ]);
  });

  it('parses a list in the caller order', () => {
    expect(parseEnabledRoutes(' usdc:base , usdc:arbitrum ')).toEqual([
      { asset: 'USDC', chain: 'base', key: 'usdc:base' },
      { asset: 'USDC', chain: 'arbitrum', key: 'usdc:arbitrum' },
    ]);
  });

  it('rejects an empty segment', () => {
    expect(issues('usdc:base,')).toEqual(['segment 2 is empty']);
    expect(issues(',usdc:base')).toEqual(['segment 1 is empty']);
  });

  it('rejects a segment without exactly one colon', () => {
    expect(issues('usdc')[0]).toContain('must have the form <asset>:<chain>');
    expect(issues('usdc:base:extra')[0]).toContain(
      'must have the form <asset>:<chain>',
    );
  });

  it('rejects an empty asset or chain', () => {
    expect(issues(':base')[0]).toContain('empty asset or chain');
    expect(issues('usdc:')[0]).toContain('empty asset or chain');
  });

  it('rejects unknown assets and chains with the valid values', () => {
    expect(issues('dai:base')[0]).toContain('unknown asset "dai"');
    expect(issues('usdc:solana')[0]).toContain('unknown chain "solana"');
    expect(issues('usdc:solana')[0]).toContain('base, ethereum');
  });

  it('rejects duplicate routes', () => {
    expect(issues('usdc:base,USDC:base')).toEqual([
      'route "usdc:base" is listed more than once',
    ]);
  });

  it('reports every malformed segment in one error', () => {
    expect(issues('usdc,base:,dai:base')).toHaveLength(3);
  });
});
