import type { PriceReader, PriceReading } from './types';

export class MockPriceReader implements PriceReader {
  private readonly prices: Map<string, PriceReading>;

  constructor(initialPrices?: Record<string, PriceReading>) {
    const now = Math.floor(Date.now() / 1000);
    this.prices = new Map();

    const defaults: Record<string, PriceReading> = {
      PUSD: {
        asset: 'PUSD',
        usdPrice: '0.998',
        source: 'Cauldron',
        asOf: now,
      },
      TPUSD: {
        asset: 'PUSD',
        usdPrice: '0.998',
        source: 'Cauldron',
        asOf: now,
      },
      MUSD: {
        asset: 'MUSD',
        usdPrice: '1.000',
        source: 'Cauldron',
        asOf: now,
      },
      TMUSD: {
        asset: 'MUSD',
        usdPrice: '1.000',
        source: 'Cauldron',
        asOf: now,
      },
      USDC: {
        asset: 'USDC',
        usdPrice: '1.000',
        source: 'Chainlink',
        asOf: now,
      },
      USDT: {
        asset: 'USDT',
        usdPrice: '1.000',
        source: 'Chainlink',
        asOf: now,
      },
    };

    const merged = { ...defaults, ...(initialPrices ?? {}) };
    for (const [key, value] of Object.entries(merged)) {
      this.prices.set(key.toUpperCase(), value);
    }
  }

  setPrice(asset: string, reading: PriceReading): void {
    this.prices.set(asset.toUpperCase(), reading);
  }

  async readPrice(asset: string): Promise<PriceReading> {
    const key = asset.toUpperCase();
    const reading = this.prices.get(key);
    if (!reading) {
      throw new Error(`Live reference price unavailable for ${asset}`);
    }
    return reading;
  }
}
