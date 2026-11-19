import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './routes/LandingPage';
import { RequireWallet } from './components/RequireWallet';

function lazyPage<T extends Record<string, unknown>>(
  load: () => Promise<T>,
  name: keyof T,
) {
  return lazy(async () => {
    const m = await load();
    return { default: m[name] as React.ComponentType };
  });
}

const FeaturesPage = lazyPage(
  () => import('./routes/FeaturesPage'),
  'FeaturesPage',
);
const StatsPage = lazyPage(() => import('./routes/StatsPage'), 'StatsPage');
const HowItWorksPage = lazyPage(
  () => import('./routes/HowItWorksPage'),
  'HowItWorksPage',
);
const HelpPage = lazyPage(() => import('./routes/HelpPage'), 'HelpPage');
const SwapPage = lazyPage(() => import('./routes/SwapPage'), 'SwapPage');
const PayLinkHubPage = lazyPage(
  () => import('./routes/PayLinkHubPage'),
  'PayLinkHubPage',
);
const ActivityPage = lazyPage(
  () => import('./routes/ActivityPage'),
  'ActivityPage',
);
const SwapStatusPage = lazyPage(
  () => import('./routes/SwapStatusPage'),
  'SwapStatusPage',
);
const PayLinkPage = lazyPage(
  () => import('./routes/PayLinkPage'),
  'PayLinkPage',
);
const SendLinkPage = lazyPage(
  () => import('./routes/SendLinkPage'),
  'SendLinkPage',
);
const RecoverPage = lazyPage(
  () => import('./routes/RecoverPage'),
  'RecoverPage',
);
const RouteStatusPage = lazyPage(
  () => import('./routes/RouteStatusPage'),
  'RouteStatusPage',
);
const NotFoundPage = lazyPage(
  () => import('./routes/NotFoundPage'),
  'NotFoundPage',
);

function Page({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          className="mx-auto max-w-xl py-16 text-center text-xs text-text-muted"
          role="status"
        >
          Loading…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/** Old links keep working: /p/<id> and /s/<id> became /pay/<id> and /send/<id>. */
function RedirectWithId({ to }: { to: 'pay' | 'send' }) {
  const { id } = useParams();
  return <Navigate to={`/${to}/${id ?? ''}`} replace />;
}

function RedirectWithOrder() {
  const { orderId } = useParams();
  return <Navigate to={`/app/swap/${orderId ?? ''}`} replace />;
}

/** One title per page, so tabs and history say where you are. */
const LANDING_TITLE = 'Ferry | Atomic Stablecoin Swaps on Bitcoin Cash';

export function titleFor(pathname: string, search: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return LANDING_TITLE;
  if (path.startsWith('/send/')) return 'Send | Ferry';
  if (path.startsWith('/pay/')) return 'Pay | Ferry';
  if (path === '/app/pay-link') {
    return new URLSearchParams(search).get('type') === 'send'
      ? 'Send | Ferry'
      : 'Pay | Ferry';
  }
  if (path.startsWith('/app/swap') || path === '/swap') return 'Swap | Ferry';
  if (path === '/features') return 'Features | Ferry';
  if (path === '/how-it-works') return 'How it works | Ferry';
  if (path === '/stats') return 'Stats | Ferry';
  if (path === '/app/my-activity') return 'Activity | Ferry';
  if (path === '/app/recover') return 'Recover | Ferry';
  if (path === '/app/user-guide' || path === '/user-guide' || path === '/help')
    return 'Guide | Ferry';
  if (path === '/route-status' || path === '/app/route-status')
    return 'Routes | Ferry';
  return 'Ferry';
}

function PageTitle() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    document.title = titleFor(pathname, search);
  }, [pathname, search]);
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <PageTitle />
      <Routes>
        <Route element={<AppShell />}>
          {/* Public: no wallet needed */}
          <Route index element={<LandingPage />} />
          <Route
            path="/features"
            element={
              <Page>
                <FeaturesPage />
              </Page>
            }
          />
          <Route path="/proof" element={<Navigate to="/stats" replace />} />
          <Route
            path="/stats"
            element={
              <Page>
                <StatsPage />
              </Page>
            }
          />
          <Route
            path="/how-it-works"
            element={
              <Page>
                <HowItWorksPage />
              </Page>
            }
          />
          <Route
            path="/user-guide"
            element={
              <Page>
                <HelpPage />
              </Page>
            }
          />
          <Route
            path="/status"
            element={
              <Page>
                <RouteStatusPage />
              </Page>
            }
          />

          {/* The app: tools that act on your wallet. Recover and the guide need no wallet. */}
          <Route path="/app">
            <Route index element={<Navigate to="swap" replace />} />
            <Route
              path="swap"
              element={
                <Page>
                  <SwapPage />
                </Page>
              }
            />
            <Route
              path="swap/:orderId"
              element={
                <Page>
                  <SwapStatusPage />
                </Page>
              }
            />
            <Route
              path="pay-link"
              element={
                <Page>
                  <PayLinkHubPage />
                </Page>
              }
            />
            <Route
              path="my-activity"
              element={
                <Page>
                  <RequireWallet feature="My activity">
                    <ActivityPage />
                  </RequireWallet>
                </Page>
              }
            />
            <Route
              path="recover"
              element={
                <Page>
                  <RecoverPage />
                </Page>
              }
            />
            <Route
              path="user-guide"
              element={
                <Page>
                  <HelpPage />
                </Page>
              }
            />
          </Route>

          {/* Shared links: open from a message, no sign-in */}
          <Route
            path="/pay/:id"
            element={
              <Page>
                <PayLinkPage />
              </Page>
            }
          />
          <Route
            path="/send/:id"
            element={
              <Page>
                <SendLinkPage />
              </Page>
            }
          />

          {/* Older paths */}
          <Route path="/swap" element={<Navigate to="/app/swap" replace />} />
          <Route path="/swap/:orderId" element={<RedirectWithOrder />} />
          <Route
            path="/pay-link"
            element={<Navigate to="/app/pay-link" replace />}
          />
          <Route
            path="/my-activity"
            element={<Navigate to="/app/my-activity" replace />}
          />
          <Route
            path="/recover"
            element={<Navigate to="/app/recover" replace />}
          />
          <Route path="/help" element={<Navigate to="/user-guide" replace />} />
          <Route
            path="/activity"
            element={<Navigate to="/app/my-activity" replace />}
          />
          <Route
            path="/pay-links"
            element={<Navigate to="/app/pay-link" replace />}
          />
          <Route
            path="/send-links"
            element={<Navigate to="/app/pay-link?type=send" replace />}
          />
          <Route path="/p/:id" element={<RedirectWithId to="pay" />} />
          <Route path="/s/:id" element={<RedirectWithId to="send" />} />

          <Route
            path="*"
            element={
              <Page>
                <NotFoundPage />
              </Page>
            }
          />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
