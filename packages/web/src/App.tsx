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
