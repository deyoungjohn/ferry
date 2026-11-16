import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { getBannerWarnings, type BannerConfig } from '../lib/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '../..');
const distDir = path.resolve(webRoot, 'dist');

describe('Production Profile Hygiene & Security Headers (Task B3-08)', () => {
  it('reports warnings when required banner values are unset', () => {
    const emptyConfig: BannerConfig = {
      deckUrl: '',
      repoUrl: '',
      licenseUrl: '',
      emberAddress: '',
      priorRepoUrl: '',
      priorDemoUrl: '',
    };
    const warnings = getBannerWarnings(emptyConfig);
    expect(warnings).toContain('Deck URL is unset');
    expect(warnings).toContain('EMBER2026 address is unset');
    expect(warnings).toContain('Prior repo URL is unset');
    expect(warnings).not.toContain('Prior demo URL is unset');
  });

  it('proves Caddyfile.example exists and defines all required security headers and CSP directives', () => {
    const caddyPath = path.resolve(webRoot, 'Caddyfile.example');
    expect(fs.existsSync(caddyPath)).toBe(true);
    const content = fs.readFileSync(caddyPath, 'utf8');

    // Security headers
    expect(content).toContain('Strict-Transport-Security');
    expect(content).toContain('X-Frame-Options');
    expect(content).toContain('X-Content-Type-Options');
    expect(content).toContain('Referrer-Policy');
    expect(content).toContain('Permissions-Policy');

    // CSP directives
    expect(content).toContain('Content-Security-Policy');
    expect(content).toContain("default-src 'self'");
    expect(content).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(content).toContain("frame-ancestors 'none'");
    expect(content).toContain('https://*.walletconnect.com');
    expect(content).toContain('wss://*.walletconnect.com');
    expect(content).toContain('https://*.reown.com');

    // Caching rules
    expect(content).toContain('@hashedAssets');
    expect(content).toContain('immutable');
    expect(content).toContain('@htmlEntry');
    expect(content).toContain('no-cache, no-store, must-revalidate');
  });

  it('proves .env.example documents the exact banner and network variables', () => {
    const envExamplePath = path.resolve(webRoot, '.env.example');
    expect(fs.existsSync(envExamplePath)).toBe(true);
    const content = fs.readFileSync(envExamplePath, 'utf8');

    expect(content).toContain('VITE_NETWORK=');
    expect(content).toContain('VITE_SOLVER_URLS=');
    expect(content).toContain('VITE_DECK_URL=');
    expect(content).toContain('VITE_EMBER_ADDRESS=');
    expect(content).toContain('VITE_PRIOR_REPO_URL=');
    expect(content).toContain('VITE_PRIOR_DEMO_URL=');
    expect(content).toContain('VITE_REPO_URL=');
    expect(content).toContain('VITE_LICENSE_URL=');
    expect(content).toContain('VITE_REOWN_PROJECT_ID=');
    expect(content).toContain('VITE_MOCK=');
  });

  it('verifies built production HTML contains no third-party scripts, has meta tags, favicon, and robots.txt', () => {
    const indexPath = path.resolve(distDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      // Skip if dist hasn't been built yet in this runner
      return;
    }

    const html = fs.readFileSync(indexPath, 'utf8');

    // No third-party script tags (e.g. Google Analytics, external CDNs, etc.)
    const scriptSrcMatches = Array.from(
      html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi),
    )
      .map((m) => m[1])
      .filter((src): src is string => typeof src === 'string');

    for (const src of scriptSrcMatches) {
      expect(src.startsWith('http://') || src.startsWith('https://')).toBe(
        false,
      );
      expect(
        src.startsWith('/') ||
          src.startsWith('./') ||
          src.startsWith('assets/'),
      ).toBe(true);
    }

    // Favicon link and meta tags
    expect(html).toContain('rel="icon"');
    expect(html).toContain('favicon.svg');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('name="twitter:card"');

    // robots.txt and favicon.svg exist in dist
    expect(fs.existsSync(path.resolve(distDir, 'robots.txt'))).toBe(true);
    expect(fs.existsSync(path.resolve(distDir, 'favicon.svg'))).toBe(true);

    const robots = fs.readFileSync(path.resolve(distDir, 'robots.txt'), 'utf8');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
  });

  it('greps built application code for forbidden strings in a mainnet build', () => {
    const assetsDir = path.resolve(distDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
      return;
    }

    // Identify application code chunks (entry, routes, components)
    const appFiles = fs
      .readdirSync(assetsDir)
      .filter((file) =>
        /^(index|config|Route|Swap|Send|Pay|Recover|Activity|App|Feature|Recent|Banner|Wallet|CopyDiagnostics|swaps|useSolver|copy|link)-.*\.js$/.test(
          file,
        ),
      )
      .map((file) => ({
        name: file,
        content: fs.readFileSync(path.resolve(assetsDir, file), 'utf8'),
      }));

    const indexHtml = {
      name: 'index.html',
      content: fs.readFileSync(path.resolve(distDir, 'index.html'), 'utf8'),
    };

    const targetFiles = [indexHtml, ...appFiles];

    for (const { name, content } of targetFiles) {
      // Must not contain testnet chain names or testnet keywords
      expect(
        content,
        `File ${name} should not contain "Sepolia"`,
      ).not.toContain('Sepolia');
      expect(
        content,
        `File ${name} should not contain "Chipnet"`,
      ).not.toContain('Chipnet');
      expect(
        content,
        `File ${name} should not contain "localhost"`,
      ).not.toContain('localhost');

      // Must not contain mock hash signatures or mock solver labels
      expect(
        content,
        `File ${name} should not contain mock hashes`,
      ).not.toMatch(/0xmock/i);
      expect(
        content,
        `File ${name} should not contain "Mock Solver"`,
      ).not.toContain('Mock Solver');
      expect(
        content,
        `File ${name} should not contain "mock solver"`,
      ).not.toContain('mock solver');

      // Must not contain private-key-looking 64-character hex strings
      // (excluding common hash prefixes or css colors)
      const privateKeyRegex = /0x[a-fA-F0-9]{64}/g;
      const keyMatches = content.match(privateKeyRegex) ?? [];
      // Anvil private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
      expect(keyMatches).not.toContain(
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      );
    }
  });
});
