import { IS_MAINNET, NETWORK_PROFILE } from '../lib/config';
import { Hero } from '../components/Hero';
import { SwapCard } from '../components/SwapCard';
import { StatsRow } from '../components/StatsRow';
import { FeatureCards } from '../components/FeatureCards';
import { RecentSwapsTable } from '../components/RecentSwapsTable';
import { PegCards } from '../components/PegCards';
import { HowItWorks } from '../components/HowItWorks';
import { NetworkBlockedPage } from '../components/NetworkBlockedPage';

export function HomePage() {
  if (IS_MAINNET && !NETWORK_PROFILE.isConfigured) {
    return <NetworkBlockedPage />;
  }

  return (
    <div className="pb-20">
      <Hero />
      <SwapCard />
      <StatsRow />
      <FeatureCards />
      <RecentSwapsTable />
      <PegCards />
      <HowItWorks />
    </div>
  );
}
