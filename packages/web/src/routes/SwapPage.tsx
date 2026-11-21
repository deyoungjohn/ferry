import { IS_MAINNET, NETWORK_PROFILE } from '../lib/config';
import { SwapCard } from '../components/SwapCard';
import { StatsRow } from '../components/StatsRow';
import { RecentSwapsTable } from '../components/RecentSwapsTable';
import { NetworkBlockedPage } from '../components/NetworkBlockedPage';

export function SwapPage() {
  // Show what is missing before asking anyone to connect a wallet.
  if (IS_MAINNET && !NETWORK_PROFILE.isConfigured) {
    return <NetworkBlockedPage />;
  }
  // Everything shows before a wallet connects: the card quotes, and "Ferry it" asks for the
  // missing wallet when it is pressed.
  return (
    <div className="pb-20">
      <h1 className="sr-only">Swap</h1>
      <div className="pt-4 sm:pt-6">
        <SwapCard />
      </div>
      <StatsRow />
      <RecentSwapsTable />
    </div>
  );
}
