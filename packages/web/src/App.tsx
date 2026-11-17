import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router';
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
const ProofPage = lazyPage(() => import('./routes/ProofPage'), 'ProofPage');
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

export function App() {
  return (
    <ErrorBoundary>
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
          <Route
            path="/proof"
            element={
              <Page>
                <ProofPage />
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
            path="/recover"
            element={
              <Page>
                <RecoverPage />
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

          {/* Needs a connected wallet */}
          <Route
            path="/swap"
            element={
              <Page>
                <SwapPage />
              </Page>
            }
          />
          <Route
            path="/pay-link"
            element={
              <Page>
                <PayLinkHubPage />
              </Page>
            }
          />
          <Route
            path="/my-activity"
            element={
              <Page>
                <RequireWallet feature="My activity">
                  <ActivityPage />
                </RequireWallet>
              </Page>
            }
          />

          {/* Generated pages, opened from a shared link or a receipt */}
          <Route
            path="/swap/:orderId"
            element={
              <Page>
                <SwapStatusPage />
              </Page>
            }
          />
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

          {/* Old paths */}
          <Route path="/help" element={<Navigate to="/user-guide" replace />} />
          <Route
            path="/activity"
            element={<Navigate to="/my-activity" replace />}
          />
          <Route
            path="/pay-links"
            element={<Navigate to="/pay-link" replace />}
          />
          <Route
            path="/send-links"
            element={<Navigate to="/pay-link?type=send" replace />}
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
