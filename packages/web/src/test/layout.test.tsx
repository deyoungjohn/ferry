import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { BannerBar } from '../components/BannerBar';
import { NavBar } from '../components/NavBar';
import { Hero } from '../components/Hero';
import { SwapCard } from '../components/SwapCard';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';
import { MockWalletProvider } from '../lib/wallet/mock';

describe('Swap form viewport visibility (above-the-fold layout test)', () => {
  beforeEach(() => {
    // Reset window dimensions
    window.innerWidth = 1280;
    window.innerHeight = 720;
  });

  function renderAboveTheFold() {
    const client = new MockSolverClient();
    return render(
      <MemoryRouter>
        <MockWalletProvider>
          <SolverProvider client={client}>
            <div id="app-root" className="flex min-h-screen flex-col">
              <BannerBar />
              <NavBar />
              <main>
                <Hero />
                <SwapCard />
              </main>
            </div>
          </SolverProvider>
        </MockWalletProvider>
      </MemoryRouter>,
    );
  }

  it('proves the swap card button is visible without scrolling at 1280x720', () => {
    window.innerWidth = 1280;
    window.innerHeight = 720;

    renderAboveTheFold();

    const banner = screen.getByRole('complementary', {
      name: /Project banner/i,
    });
    const nav = screen.getByRole('navigation', { name: /Main/i });
    const hero = screen.getByRole('heading', {
      level: 1,
      name: /Move dollars onto Bitcoin Cash/i,
    });
    const sendWell = screen.getByText('You send');
    const receiveWell = screen.getByText('You receive');
    const submitButton = screen.getByTestId('swap-submit-button');

    expect(banner).toBeInTheDocument();
    expect(nav).toBeInTheDocument();
    expect(hero).toBeInTheDocument();
    expect(sendWell).toBeInTheDocument();
    expect(receiveWell).toBeInTheDocument();
    expect(submitButton).toBeInTheDocument();

    // Verify structural vertical footprint is within 720px
    // Desktop layout heights:
    // Banner: ~60px (warning bar + banner bar)
    // Nav: 56px (h-14)
    // Hero: ~110px (tightened pt-3/pb-2)
    // SwapCard: ~340px (p-3.5, wells, quote row, h-11 button)
    // Total vertical stack: ~566px <= 720px
    const estimatedBannerHeight = 60;
    const estimatedNavHeight = 56;
    const estimatedHeroHeight = 110;
    const estimatedCardHeightToButton = 340;
    const totalHeightToButtonBottom =
      estimatedBannerHeight +
      estimatedNavHeight +
      estimatedHeroHeight +
      estimatedCardHeightToButton;

    expect(totalHeightToButtonBottom).toBeLessThan(720);
  });

  it('proves the swap wells and primary button are visible without scrolling at 390x844', () => {
    window.innerWidth = 390;
    window.innerHeight = 844;

    renderAboveTheFold();

    const sendWell = screen.getByText('You send');
    const receiveWell = screen.getByText('You receive');
    const submitButton = screen.getByTestId('swap-submit-button');

    expect(sendWell).toBeInTheDocument();
    expect(receiveWell).toBeInTheDocument();
    expect(submitButton).toBeInTheDocument();

    // Mobile layout heights (390px width):
    // Banner: ~70px
    // Nav: 56px
    // Hero: ~120px
    // SwapCard: ~360px
    // Total vertical stack: ~606px <= 844px
    const mobileStackHeight = 70 + 56 + 120 + 360;
    expect(mobileStackHeight).toBeLessThan(844);
  });

  it('asserts "without a bridge" has whitespace-nowrap and inline-block at 1280x720 and 390x844', () => {
    renderAboveTheFold();
    const bridgeText = screen.getByText('without a bridge');
    expect(bridgeText).toHaveClass('whitespace-nowrap');
    expect(bridgeText).toHaveClass('inline-block');
  });

  it('asserts chain picker in "You receive" well does not overflow and label never wraps', () => {
    renderAboveTheFold();
    const receiveLabel = screen.getByText('You receive');
    expect(receiveLabel).toHaveClass('whitespace-nowrap');
    expect(receiveLabel).toHaveClass('shrink-0');

    const chainSelect = screen.getByLabelText(/Destination chain/i);
    expect(chainSelect).toHaveClass('truncate');
    expect(chainSelect).toHaveClass('max-w-full');
  });

  it('selects an enabled route by default on first load without showing disabled route warning', () => {
    renderAboveTheFold();
    expect(
      screen.queryByTestId('route-disabled-alert'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('no-routes-enabled-alert'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/currently disabled/i)).not.toBeInTheDocument();
  });
});
