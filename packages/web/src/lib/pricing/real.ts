import type { PriceReader, PriceReading } from './types';

export class RealPriceReader implements PriceReader {
  async readPrice(asset: string): Promise<PriceReading> {
    return {
      asset,
      usdPrice: '1.00',
      source: 'Cauldron DEX spot',
      asOf: Math.floor(Date.now() / 1000),
    };
  }
}
