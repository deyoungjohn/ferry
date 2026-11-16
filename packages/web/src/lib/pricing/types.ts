export interface PriceReading {
  readonly asset: string;
  readonly usdPrice: string;
  readonly source: string;
  readonly asOf: number;
}

export interface PriceReader {
  readPrice(asset: string): Promise<PriceReading>;
}
