import { IS_MAINNET, NETWORK_PROFILE } from '../lib/config';
import { RequireWallet } from '../components/RequireWallet';
import { SwapCard } from '../components/SwapCard';
import { StatsRow } from '../components/StatsRow';
import { RecentSwapsTable } from '../components/RecentSwapsTable';
import { NetworkBlockedPage } from '../components/NetworkBlockedPage';

export function SwapPage() {
  // Show what is missing before asking anyone to connect a wallet.
  if (IS_MAINNET && !NETWORK_PROFILE.isConfigured) {
    return <NetworkBlockedPage />;
  }
  // Only the swap card needs a wallet; the stats and the recent swaps are public, so they show
  // before anyone connects.
  return (
    <div className="pb-20">
      <h1 className="sr-only">Swap</h1>
      <RequireWallet feature="Swap">
        <div className="pt-4 sm:pt-6">
          <SwapCard />
        </div>
      </RequireWallet>
      <StatsRow />
      <RecentSwapsTable />
    </div>
  );
}
