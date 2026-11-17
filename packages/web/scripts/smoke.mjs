#!/usr/bin/env node
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, '..');

// Locate pre-installed Chromium in ~/.cache/ms-playwright
function resolveChromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  const defaultPath = path.resolve(
    os.homedir(),
    '.cache/ms-playwright/chromium-1247/chrome-linux64/chrome',
  );
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  const fallbackPath = path.resolve(
    os.homedir(),
    '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  );
  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }
  throw new Error(
    `Pre-installed Chromium not found at ${defaultPath} or ${fallbackPath}. Do not download browsers.`,
  );
}

// Wait for a server to respond to HTTP requests
async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await globalThis.fetch(url);
      if (res.status < 500) {
        return;
      }
    } catch {
      // Retry after delay
    }
    await sleep(250);
  }
  throw new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`);
}

// Kill process tree cleanly
function killProcess(proc) {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    // Process already exited
  }
}

async function runSmokeSuite() {
  const chromePath = resolveChromiumPath();
  console.log(`[smoke] Using Chromium executable: ${chromePath}`);

  const activeProcesses = [];

  try {
    // -------------------------------------------------------------
    // Target 1: Dev server in mock mode (VITE_NETWORK=testnet VITE_MOCK=1)
    // -------------------------------------------------------------
    const mockPort = 5193;
    const mockUrl = `http://localhost:${mockPort}`;
    console.log(
      `[smoke] Starting testnet mock dev server on port ${mockPort}...`,
    );

    const mockDevProc = spawn(
      'pnpm',
      ['vite', '--port', String(mockPort), '--strictPort'],
      {
        cwd: webDir,
        env: {
          ...process.env,
          VITE_NETWORK: 'testnet',
          VITE_MOCK: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    activeProcesses.push(mockDevProc);

    mockDevProc.stderr.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('error') && !msg.includes('deprecated')) {
        console.error(`[mock-dev stderr] ${msg.trim()}`);
      }
    });

    await waitForServer(mockUrl);
    console.log(`[smoke] Mock dev server ready at ${mockUrl}`);

    // Launch Playwright
    const browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    // Helper to open page with strict console / pageerror failure detection
    async function testUrl(urlPath, viewport, options = {}) {
      const errors = [];
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      page.on('pageerror', (err) => {
        errors.push(`PageError: ${err.message}\n${err.stack}`);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push(`ConsoleError: ${msg.text()}`);
        }
      });

      const fullUrl = `${mockUrl}${urlPath}`;
      console.log(
        `[smoke] Navigating to ${fullUrl} [${viewport.width}x${viewport.height}]...`,
      );
      await page.goto(fullUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      // 1. Fail on pageerror or console error
      if (errors.length > 0) {
        throw new Error(
          `Errors encountered on ${fullUrl}:\n${errors.join('\n')}`,
        );
      }

      // 2. Fail on empty #root
      const rootHtml = await page.$eval('#root', (el) => el.innerHTML.trim());
      if (!rootHtml || rootHtml.length === 0) {
        throw new Error(`Page #root is empty on ${fullUrl}`);
      }

      if (options.onPage) {
        await options.onPage(page);
      }

      await context.close();
    }

    // 1. Test Home on Mock Dev Server (1280x720)
    await testUrl(
      '/',
      { width: 1280, height: 720 },
      {
        onPage: async (page) => {
          // Assert hero is visible
          const heroHeading = page.locator('h1');
          await heroHeading.waitFor({ state: 'visible' });
          const heroText = await heroHeading.textContent();
          if (!heroText.includes('Move dollars onto Bitcoin Cash')) {
            throw new Error(
              `Hero heading text missing expected content: "${heroText}"`,
            );
          }

          // Assert "without a bridge" element
          const bridgeSpan = page.locator('span:has-text("without a bridge")');
          await bridgeSpan.waitFor({ state: 'visible' });

          // Landing page: the call to action leads to the app
          const cta = page.locator('a:has-text("Open Ferry")');
          await cta.first().waitFor({ state: 'visible' });

          // Save 1280x720 mock home screenshot to /tmp
          const screenshotPath = '/tmp/ferry-screenshot-home-1280x720.png';
          await page.screenshot({ path: screenshotPath });
          console.log(`[smoke] Saved screenshot: ${screenshotPath}`);
        },
      },
    );

    // 2. Test Home on Mock Dev Server (390x844 Mobile)
    await testUrl(
      '/',
      { width: 390, height: 844 },
      {
        onPage: async (page) => {
          const heroHeading = page.locator('h1');
          await heroHeading.waitFor({ state: 'visible' });
          const cta = page.locator('a:has-text("Open Ferry")');
          await cta.first().waitFor({ state: 'visible' });

          // Save 390x844 mock home screenshot to /tmp
          const screenshotPath = '/tmp/ferry-screenshot-home-390x844.png';
          await page.screenshot({ path: screenshotPath });
          console.log(`[smoke] Saved screenshot: ${screenshotPath}`);
        },
      },
    );

    // 3. Test /status route
    await testUrl(
      '/status',
      { width: 1280, height: 720 },
      {
        onPage: async (page) => {
          const heading = page.locator('h1:has-text("Route Status")');
          await heading.waitFor({ state: 'visible' });
        },
      },
    );

    // 4. Test /help route
    await testUrl(
      '/user-guide',
      { width: 1280, height: 720 },
      {
        onPage: async (page) => {
          const heading = page.locator('h1:has-text("User Guide")');
          await heading.waitFor({ state: 'visible' });
        },
      },
    );

    // Public pages render without a wallet
    for (const [route, heading] of [
      ['/features', 'What Ferry does'],
      ['/proof', 'Proof'],
      ['/how-it-works', 'How it works'],
    ]) {
      await testUrl(
        route,
        { width: 1280, height: 720 },
        {
          onPage: async (page) => {
            await page
              .locator(`h1:has-text("${heading}")`)
              .waitFor({ state: 'visible' });
          },
        },
      );
    }

    // Pages that need a wallet show the connect gate instead
    for (const route of ['/app/swap', '/app/pay-link', '/app/my-activity']) {
      await testUrl(
        route,
        { width: 1280, height: 720 },
        {
          onPage: async (page) => {
            const gate = page.locator('[data-testid="wallet-gate"]');
            await gate.waitFor({ state: 'visible' });
          },
        },
      );
    }

    // 5. Test /recover route
    await testUrl(
      '/app/recover',
      { width: 1280, height: 720 },
      {
        onPage: async (page) => {
          const heading = page.locator('h1:has-text("Recover a Swap")');
          await heading.waitFor({ state: 'visible' });
          const explainer = page.locator(
            '[data-testid="what-is-recovery-panel"]',
          );
          await explainer.waitFor({ state: 'visible' });
        },
      },
    );

    // Shut down mock dev server before mainnet target
    killProcess(mockDevProc);
    activeProcesses.length = 0;

    // -------------------------------------------------------------
    // Target 2: Mainnet Profile ("not configured" page)
    // -------------------------------------------------------------
    const mainnetPort = 5194;
    const mainnetUrl = `http://localhost:${mainnetPort}/app/swap`;
    console.log(
      `[smoke] Starting mainnet dev server on port ${mainnetPort}...`,
    );

    const mainnetDevProc = spawn(
      'pnpm',
      ['vite', '--port', String(mainnetPort), '--strictPort'],
      {
        cwd: webDir,
        env: {
          ...process.env,
          VITE_NETWORK: 'mainnet',
          VITE_MOCK: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    activeProcesses.push(mainnetDevProc);

    await waitForServer(mainnetUrl);
    console.log(`[smoke] Mainnet dev server ready at ${mainnetUrl}`);

    async function testMainnetUrl(viewport, screenshotPath) {
      const errors = [];
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      page.on('pageerror', (err) => {
        errors.push(`PageError: ${err.message}\n${err.stack}`);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push(`ConsoleError: ${msg.text()}`);
        }
      });

      console.log(
        `[smoke] Navigating to mainnet ${mainnetUrl} [${viewport.width}x${viewport.height}]...`,
      );
      await page.goto(mainnetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      if (errors.length > 0) {
        throw new Error(`Errors on mainnet page:\n${errors.join('\n')}`);
      }

      const rootHtml = await page.$eval('#root', (el) => el.innerHTML.trim());
      if (!rootHtml || rootHtml.length === 0) {
        throw new Error('Mainnet #root is empty');
      }

      // Assert not configured heading
      const heading = page.locator('h1:has-text("Configuration Incomplete")');
      await heading.waitFor({ state: 'visible' });

      // Assert link to status page
      const statusLink = page.locator('[data-testid="link-to-status"]');
      await statusLink.waitFor({ state: 'visible' });

      // Assert per-route list
      const baseRoute = page.locator('[data-testid="mainnet-route-base"]');
      await baseRoute.waitFor({ state: 'visible' });

      if (screenshotPath) {
        await page.screenshot({ path: screenshotPath });
        console.log(`[smoke] Saved screenshot: ${screenshotPath}`);
      }

      await context.close();
    }

    await testMainnetUrl(
      { width: 1280, height: 720 },
      '/tmp/ferry-screenshot-not-configured-1280x720.png',
    );
    await testMainnetUrl(
      { width: 390, height: 844 },
      '/tmp/ferry-screenshot-not-configured-390x844.png',
    );

    killProcess(mainnetDevProc);
    activeProcesses.length = 0;

    // -------------------------------------------------------------
    // Target 3: vite preview of the production build
    // -------------------------------------------------------------
    const previewPort = 5195;
    const previewUrl = `http://localhost:${previewPort}`;
    console.log(`[smoke] Building production web distribution for preview...`);

    const buildProc = spawn('pnpm', ['vite', 'build'], {
      cwd: webDir,
      env: {
        ...process.env,
        VITE_NETWORK: 'mainnet',
        VITE_MOCK: '',
      },
      stdio: 'inherit',
    });

    await new Promise((resolve, reject) => {
      buildProc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`vite build failed with exit code ${code}`));
      });
    });

    console.log(`[smoke] Starting vite preview on port ${previewPort}...`);
    const previewProc = spawn(
      'pnpm',
      ['vite', 'preview', '--port', String(previewPort), '--strictPort'],
      {
        cwd: webDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    activeProcesses.push(previewProc);

    await waitForServer(previewUrl);
    console.log(`[smoke] Preview server ready at ${previewUrl}`);

    // Test preview in real browser
    const previewContext = await browser.newContext({
      viewport: {
        width: 1280,
        height: 720,
      },
    });
    const previewPage = await previewContext.newPage();
    const previewErrors = [];
    previewPage.on('pageerror', (e) => previewErrors.push(e.message));
    previewPage.on('console', (m) => {
      if (m.type() === 'error') previewErrors.push(m.text());
    });

    await previewPage.goto(`${previewUrl}/app/swap`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    if (previewErrors.length > 0) {
      throw new Error(`Preview errors:\n${previewErrors.join('\n')}`);
    }

    const previewRoot = await previewPage.$eval('#root', (el) =>
      el.innerHTML.trim(),
    );
    if (!previewRoot || previewRoot.length === 0) {
      throw new Error('Preview #root is empty');
    }

    // In production mainnet build without solver configured, mainnet page renders
    const previewHeading = previewPage.locator(
      'h1:has-text("Configuration Incomplete")',
    );
    await previewHeading.waitFor({ state: 'visible' });
    const statusLink = previewPage.locator('[data-testid="link-to-status"]');
    await statusLink.waitFor({ state: 'visible' });

    // Also verify preview can navigate to /status
    await previewPage.goto(`${previewUrl}/status`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    if (previewErrors.length > 0) {
      throw new Error(`Preview /status errors:\n${previewErrors.join('\n')}`);
    }
    const statusHeading = previewPage.locator('h1:has-text("Route Status")');
    await statusHeading.waitFor({ state: 'visible' });

    await previewContext.close();
    await browser.close();

    console.log('[smoke] All real-browser smoke tests passed cleanly!');
  } finally {
    for (const proc of activeProcesses) {
      killProcess(proc);
    }
  }
}

runSmokeSuite().catch((err) => {
  console.error('[smoke] Failed:', err);
  process.exit(1);
});
