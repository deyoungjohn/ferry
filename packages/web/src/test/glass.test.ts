import { describe, it, expect } from 'vitest';
import { GlassLayerBudget, MAX_GLASS_LAYERS } from '../lib/glass-layer';
import { isLensSupported, type LensEnvironment } from '../lib/glass';

describe('Liquid Glass system', () => {
  it('enforces a maximum of 2 glass layers on screen at once', () => {
    const budget = new GlassLayerBudget(MAX_GLASS_LAYERS);
    expect(budget.activeCount).toBe(0);

    const release1 = budget.acquire('nav');
    expect(budget.activeCount).toBe(1);

    const release2 = budget.acquire('modal');
    expect(budget.activeCount).toBe(2);

    expect(() => budget.acquire('toast')).toThrow(
      'At most 2 glass layers may be visible at once',
    );

    release2();
    expect(budget.activeCount).toBe(1);

    const release3 = budget.acquire('toast');
    expect(budget.activeCount).toBe(2);

    release1();
    release3();
    expect(budget.activeCount).toBe(0);
  });

  describe('isLensSupported', () => {
    it('returns true when backdrop-filter URL and Chromium user agent are present', () => {
      const env: LensEnvironment = {
        supports: (prop, val) =>
          prop === 'backdrop-filter' && val.includes('url('),
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Chromium/128.0.0.0',
      };
      expect(isLensSupported(env)).toBe(true);
    });

    it('returns false when browser does not support SVG URL backdrop-filter', () => {
      const env: LensEnvironment = {
        supports: () => false,
        userAgent: 'Chromium/128.0.0.0',
      };
      expect(isLensSupported(env)).toBe(false);
    });

    it('returns false on non-Chromium browsers even if CSS.supports is loose', () => {
      const env: LensEnvironment = {
        supports: () => true,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      };
      expect(isLensSupported(env)).toBe(false);
    });
  });
});
