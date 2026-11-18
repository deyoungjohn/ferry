export type Chain = {
  id: string;
  name: string;
  tone: string;
  symbol: string;
};

export type Token = {
  id: string;
  symbol: string;
  name: string;
  chainId: string;
  address?: string;
  balance?: number;
  usd?: number;
  trending?: boolean;
  /** When set the token is shown but cannot be picked; the text says why. */
  disabledReason?: string;
  popular?: boolean;
};

export type TokenSide = 'from' | 'to';
