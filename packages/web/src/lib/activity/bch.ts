import {
  fetchBchActivity as coreFetchBchActivity,
  type BchActivityItem,
  type BchActivityResult,
  type BchElectrum,
  type FetchBchActivityOptions,
} from '@ferry/htlc-bch';

export type {
  BchActivityItem,
  BchActivityResult,
  BchElectrum,
  FetchBchActivityOptions,
};

export async function fetchBchActivity(
  options: FetchBchActivityOptions,
): Promise<BchActivityResult> {
  return coreFetchBchActivity(options);
}
