import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { HomePage } from './routes/HomePage';

const NotFoundPage = lazy(async () => {
  const m = await import('./routes/NotFoundPage');
  return { default: m.NotFoundPage };
});

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
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
