import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { HomePage } from './routes/HomePage';

const NotFoundPage = lazy(async () => {
  const m = await import('./routes/NotFoundPage');
  return { default: m.NotFoundPage };
});

const SwapStatusPage = lazy(async () => {
  const m = await import('./routes/SwapStatusPage');
  return { default: m.SwapStatusPage };
});

const ActivityPage = lazy(async () => {
  const m = await import('./routes/ActivityPage');
  return { default: m.ActivityPage };
});

const RecoverPage = lazy(async () => {
  const m = await import('./routes/RecoverPage');
  return { default: m.RecoverPage };
});

const PayLinksPage = lazy(async () => {
  const m = await import('./routes/PayLinksPage');
  return { default: m.PayLinksPage };
});

const PayLinkPage = lazy(async () => {
  const m = await import('./routes/PayLinkPage');
  return { default: m.PayLinkPage };
});

const SendLinksPage = lazy(async () => {
  const m = await import('./routes/SendLinksPage');
  return { default: m.SendLinksPage };
});

const SendLinkPage = lazy(async () => {
  const m = await import('./routes/SendLinkPage');
  return { default: m.SendLinkPage };
});

const RouteStatusPage = lazy(async () => {
  const m = await import('./routes/RouteStatusPage');
  return { default: m.RouteStatusPage };
});

const HelpPage = lazy(async () => {
  const m = await import('./routes/HelpPage');
  return { default: m.HelpPage };
});

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route
          path="/swap/:orderId"
          element={
            <Suspense
              fallback={
                <div
                  className="mx-auto max-w-xl py-16 text-center text-xs text-text-muted"
                  role="status"
                >
                  Loading status…
                </div>
              }
            >
              <SwapStatusPage />
            </Suspense>
          }
        />
        <Route
          path="/activity"
          element={
            <Suspense fallback={null}>
              <ActivityPage />
            </Suspense>
          }
        />
        <Route
          path="/recover"
          element={
            <Suspense fallback={null}>
              <RecoverPage />
            </Suspense>
          }
        />
        <Route
          path="/pay-links"
          element={
            <Suspense fallback={null}>
              <PayLinksPage />
            </Suspense>
          }
        />
        <Route
          path="/p/:id"
          element={
            <Suspense fallback={null}>
              <PayLinkPage />
            </Suspense>
          }
        />
        <Route
          path="/send-links"
          element={
            <Suspense fallback={null}>
              <SendLinksPage />
            </Suspense>
          }
        />
        <Route
          path="/s/:id"
          element={
            <Suspense fallback={null}>
              <SendLinkPage />
            </Suspense>
          }
        />
        <Route
          path="/status"
          element={
            <Suspense fallback={null}>
              <RouteStatusPage />
            </Suspense>
          }
        />
        <Route
          path="/help"
          element={
            <Suspense fallback={null}>
              <HelpPage />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <Suspense fallback={null}>
              <NotFoundPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
