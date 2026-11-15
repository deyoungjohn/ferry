import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource-variable/inter';
import '@fontsource/instrument-serif';
import './styles/index.css';
import { App } from './App';
import { SolverProvider } from './lib/solver/SolverProvider';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <SolverProvider>
        <App />
      </SolverProvider>
    </BrowserRouter>
  </StrictMode>,
);
