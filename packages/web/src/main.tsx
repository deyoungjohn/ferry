import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router';
import '@fontsource-variable/inter';
import './styles/index.css';
import { App } from './App';
import { SolverProvider } from './lib/solver/SolverProvider';
import { installChunkReload } from './lib/chunk-reload';

// A page opened before a deploy reloads once instead of failing on a missing chunk.
installChunkReload();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// IPFS and standalone routing support (FR-16 stretch)
const isHash = import.meta.env?.VITE_ROUTER === 'hash';

createRoot(rootElement).render(
  <StrictMode>
    {isHash ? (
      <HashRouter>
        <SolverProvider>
          <App />
        </SolverProvider>
      </HashRouter>
    ) : (
      <BrowserRouter>
        <SolverProvider>
          <App />
        </SolverProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
);
