import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  resolveBasePath,
  withBasePath,
  formatAppUrl,
  payLinkUrl,
  sendLinkUrl,
  swapStatusUrl,
  routeStatusUrl,
  recoveryPageUrl,
  helpPageUrl,
  getLandingUrl,
  getRouterBasename,
} from '../lib/base-path';
import { parseSolverOrigins } from '../lib/config';
import { RealSolverClient } from '../lib/solver/real';
import { RouteStatusPage } from '../routes/RouteStatusPage';
import { SolverProvider } from '../lib/solver/SolverProvider';

describe('Base Path & Link Generation (Subpath Support)', () => {
  describe('resolveBasePath', () => {
    it('returns / by default or when empty', () => {
      expect(resolveBasePath()).toBe('/');
      expect(resolveBasePath('')).toBe('/');
      expect(resolveBasePath('/')).toBe('/');
      expect(resolveBasePath('   ')).toBe('/');
    });

    it('normalizes subpaths to have leading and trailing slashes', () => {
      expect(resolveBasePath('swap')).toBe('/swap/');
      expect(resolveBasePath('/swap')).toBe('/swap/');
      expect(resolveBasePath('swap/')).toBe('/swap/');
      expect(resolveBasePath('/swap/')).toBe('/swap/');
      expect(resolveBasePath('/app/nested/')).toBe('/app/nested/');
    });

    it('returns ./ for hash router', () => {
      expect(resolveBasePath('/swap/', true)).toBe('./');
      expect(resolveBasePath('', true)).toBe('./');
    });
  });

  describe('withBasePath', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('prepends base path to paths without duplicating', () => {
      // Test when base path is /swap/
      const prevMeta = import.meta.env.VITE_BASE_PATH;
      try {
        import.meta.env.VITE_BASE_PATH = '/swap/';
        expect(withBasePath('/status')).toBe('/swap/status');
        expect(withBasePath('/help')).toBe('/swap/help');
        expect(withBasePath('/swap/status')).toBe('/swap/status');
        expect(withBasePath('status')).toBe('/swap/status');
      } finally {
        import.meta.env.VITE_BASE_PATH = prevMeta;
      }
    });
  });

  describe('URL generators under base path', () => {
    const prevMeta = import.meta.env.VITE_BASE_PATH;

    beforeEach(() => {
      import.meta.env.VITE_BASE_PATH = '/swap/';
    });

    afterEach(() => {
      import.meta.env.VITE_BASE_PATH = prevMeta;
    });

    it('generates pay links starting with base path', () => {
      const url = payLinkUrl('test-123');
      expect(url).toContain('/swap/p/test-123');
      expect(new URL(url).pathname).toBe('/swap/p/test-123');
    });

    it('generates send links starting with base path', () => {
      const url = sendLinkUrl('send-abc');
      expect(url).toContain('/swap/s/send-abc');
      expect(new URL(url).pathname).toBe('/swap/s/send-abc');
    });

    it('generates swap status links starting with base path', () => {
      const url = swapStatusUrl('ord-xyz-456');
      expect(url).toContain('/swap/swap/ord-xyz-456');
      expect(new URL(url).pathname).toBe('/swap/swap/ord-xyz-456');
    });

    it('generates status page link starting with base path', () => {
      const url = routeStatusUrl();
      expect(url).toContain('/swap/status');
      expect(new URL(url).pathname).toBe('/swap/status');
    });

    it('generates recovery page link starting with base path', () => {
      const url = recoveryPageUrl();
      expect(url).toContain('/swap/recover');
      expect(new URL(url).pathname).toBe('/swap/recover');
    });

    it('generates help page link starting with base path', () => {
      const url = helpPageUrl();
      expect(url).toContain('/swap/help');
      expect(new URL(url).pathname).toBe('/swap/help');
    });

    it('ensures formatAppUrl correctly maps all routes to subpath', () => {
      const routes = [
        '/',
        '/status',
        '/help',
        '/recover',
        '/pay-links',
        '/send-links',
        '/p/demo',
        '/s/claim',
        '/swap/123',
      ];
      for (const route of routes) {
        const generated = formatAppUrl(route);
        const parsed = new URL(generated);
        expect(parsed.pathname.startsWith('/swap')).toBe(true);
      }
    });
  });

  describe('getLandingUrl', () => {
    it('defaults to /', () => {
      const prev = import.meta.env.VITE_LANDING_URL;
      try {
        delete import.meta.env.VITE_LANDING_URL;
        expect(getLandingUrl()).toBe('/');
      } finally {
        import.meta.env.VITE_LANDING_URL = prev;
      }
    });

    it('uses configured VITE_LANDING_URL', () => {
      const prev = import.meta.env.VITE_LANDING_URL;
      try {
        import.meta.env.VITE_LANDING_URL = 'https://ferry.incepture.dev';
        expect(getLandingUrl()).toBe('https://ferry.incepture.dev');
      } finally {
        import.meta.env.VITE_LANDING_URL = prev;
      }
    });
  });

  describe('getRouterBasename', () => {
    it('returns subpath without trailing slash for BrowserRouter', () => {
      const prev = import.meta.env.VITE_BASE_PATH;
      try {
        import.meta.env.VITE_BASE_PATH = '/swap/';
        expect(getRouterBasename()).toBe('/swap');

        import.meta.env.VITE_BASE_PATH = '/';
        expect(getRouterBasename()).toBeUndefined();
      } finally {
        import.meta.env.VITE_BASE_PATH = prev;
      }
    });
  });

  describe('parseSolverOrigins', () => {
    it('strips trailing slashes and /v1 suffix from configured solver URLs', () => {
      const origins = parseSolverOrigins(
        'https://ferry.incepture.dev/, https://solver2.ferry.cash/v1, http://localhost:8080/v1/',
      );
      expect(origins).toEqual([
        'https://ferry.incepture.dev',
        'https://solver2.ferry.cash',
        'http://localhost:8080',
      ]);
    });
  });

  describe('Solver HTML detection on /status', () => {
    it('throws "this URL is not a Ferry solver" if solver returns HTML instead of JSON', async () => {
      const client = new RealSolverClient({
        baseUrl: 'https://ferry.incepture.dev',
        fetch: async () => {
          return new Response(
            '<!doctype html><html><body><h1>Welcome to Ferry Landing</h1></body></html>',
            {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=UTF-8' },
            },
          );
        },
      });

      await expect(client.getHealth()).rejects.toThrow(
        /this URL is not a Ferry solver/,
      );
    });

    it('displays "this URL is not a Ferry solver" on the RouteStatusPage when solver returns HTML', async () => {
      const client = new RealSolverClient({
        baseUrl: 'https://ferry.incepture.dev',
        fetch: async () => {
          return new Response(
            '<!doctype html><html><head><title>Ferry</title></head><body>Landing Page</body></html>',
            {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            },
          );
        },
      });

      render(
        <MemoryRouter initialEntries={['/status']}>
          <SolverProvider client={client}>
            <RouteStatusPage />
          </SolverProvider>
        </MemoryRouter>,
      );

      // Verify that the plain warning for the maintainer is rendered
      await waitFor(() => {
        expect(
          screen.getByTestId('solver-not-ferry-alert'),
        ).toBeInTheDocument();
      });

      expect(
        screen.getAllByText(/this URL is not a Ferry solver/i).length,
      ).toBeGreaterThanOrEqual(1);

      const badge = screen.getByTestId('solver-health-badge');
      expect(badge).toHaveTextContent(/this URL is not a Ferry solver/i);
    });
  });
});
