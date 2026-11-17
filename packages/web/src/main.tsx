import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router';
import '@fontsource-variable/inter';
import '@fontsource/instrument-serif';
import './styles/index.css';
import { App } from './App';
import { SolverProvider } from './lib/solver/SolverProvider';
import { getRouterBasename } from './lib/base-path';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// IPFS and standalone routing support (FR-16 stretch)
const isHash = import.meta.env?.VITE_ROUTER === 'hash';
const routerBasename = getRouterBasename();

createRoot(rootElement).render(
  <StrictMode>
    {isHash ? (
      <HashRouter>
        <SolverProvider>
          <App />
        </SolverProvider>
      </HashRouter>
    ) : routerBasename ? (
      <BrowserRouter basename={routerBasename}>
        <SolverProvider>
          <App />
        </SolverProvider>
      </BrowserRouter>
    ) : (
      <BrowserRouter>
        <SolverProvider>
          <App />
        </SolverProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
);
