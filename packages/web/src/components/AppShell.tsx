import { useMemo } from 'react';
import { Outlet } from 'react-router';
import { BannerBar } from './BannerBar';
import { NavBar } from './NavBar';
import { Footer } from './Footer';
import { GlassLayerContext, GlassLayerBudget } from '../lib/glass-layer';
import { WalletProvider } from '../lib/wallet/WalletProvider';

export function AppShell() {
  const budget = useMemo(() => new GlassLayerBudget(2), []);

  return (
    <GlassLayerContext.Provider value={budget}>
      <WalletProvider>
        <div className="ferry-page min-h-screen flex flex-col justify-between">
          <div>
            <BannerBar />
            <NavBar />
            <main>
              <Outlet />
            </main>
          </div>
          <Footer />
        </div>
      </WalletProvider>
    </GlassLayerContext.Provider>
  );
}
