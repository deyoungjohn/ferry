import { describe, expect, it } from 'vitest';
import { chainIconUrl, tokenIconUrl } from '../lib/icons';

describe('token and chain icons', () => {
  it('returns artwork for USDG', () => {
    expect(tokenIconUrl('USDG')).toContain('usdg.svg');
    expect(tokenIconUrl('usdg')).toContain('usdg.svg');
  });

  it('returns the artwork for known tokens', () => {
    expect(tokenIconUrl('USDC')).toContain('usdc.svg');
    expect(tokenIconUrl('USDT')).toContain('usdt.svg');
  });

  it('returns Robinhood chain artwork for chain 4663', () => {
    expect(chainIconUrl(4663)).toContain('robinhood.png');
    expect(chainIconUrl('robinhood')).toContain('robinhood.png');
  });
});
