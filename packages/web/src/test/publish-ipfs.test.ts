// @vitest-environment node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

interface PublishIpfsModule {
  computeDistCid: (dirPath: string) => Promise<string>;
  publishIpfs: (options?: {
    pin?: boolean;
    skipBuild?: boolean;
    provider?: {
      name: string;
      pin: (opts: {
        distDir: string;
        cid: string;
        token: string;
        fetchFn?: typeof fetch;
      }) => Promise<{ cid: string; status?: string }>;
      getFreeTierNotes: () => string;
    };
    token?: string;
    fetchFn?: typeof fetch;
  }) => Promise<{
    cid: string;
    dryRun?: boolean;
    pinned?: boolean;
    status?: string;
  }>;
  pinataProvider: {
    name: string;
    pin: (opts: {
      distDir: string;
      cid: string;
      token: string;
      fetchFn?: typeof fetch;
    }) => Promise<{ cid: string; status?: string }>;
    getFreeTierNotes: () => string;
  };
}

// Dynamically import the publish script
const { computeDistCid, publishIpfs, pinataProvider } = (await import(
  // @ts-expect-error script module outside tsconfig
  '../../scripts/publish-ipfs.mjs'
)) as unknown as PublishIpfsModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '../..');
const distDir = path.resolve(webRoot, 'dist');

describe('IPFS Publish Script & Pinning Provider (Task B3-09)', () => {
  it('computes a valid IPFS CIDv1 from distribution directory', async () => {
    if (!fs.existsSync(distDir)) {
      // Ensure dist exists for test
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, 'index.html'), '<html>test</html>');
    }

    const cid = await computeDistCid(distDir);
    expect(cid).toBeDefined();
    expect(typeof cid).toBe('string');
    // CIDv1 begins with base32 multibase prefix 'b'
    expect(cid.startsWith('b') || cid.startsWith('Qm')).toBe(true);
  });

  it('runs dry-run by default without calling any pinning API', async () => {
    const fakeProvider = {
      name: 'FakeProvider',
      getFreeTierNotes: vi.fn(() => "Check the provider's current page"),
      pin: vi.fn(),
    };

    const res = await publishIpfs({
      pin: false,
      skipBuild: true,
      provider: fakeProvider,
    });

    expect(res.dryRun).toBe(true);
    expect(res.cid).toBeDefined();
    // In dry-run mode, pin must NOT be called
    expect(fakeProvider.pin).not.toHaveBeenCalled();
    expect(fakeProvider.getFreeTierNotes).toHaveBeenCalled();
  });

  it('pins via provider when --pin is requested with a valid token', async () => {
    const fakeProvider = {
      name: 'MockPinningService',
      getFreeTierNotes: () =>
        "Check the provider's current page for free-tier limits",
      pin: vi.fn().mockResolvedValue({ cid: 'bafytest123', status: 'pinned' }),
    };

    const secretToken = 'super-secret-token-xyz';
    const res = await publishIpfs({
      pin: true,
      skipBuild: true,
      provider: fakeProvider,
      token: secretToken,
    });

    expect(res.pinned).toBe(true);
    expect(fakeProvider.pin).toHaveBeenCalledWith(
      expect.objectContaining({
        cid: expect.any(String),
        token: secretToken,
      }),
    );
  });

  it('fails gracefully and never prints secrets when token is missing or pin fails', async () => {
    const secretToken = 'my-confidential-jwt-token-999';

    // Mock fetch that rejects with an error
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'Invalid auth' }),
    });

    let errorCaught: Error | null = null;
    try {
      await pinataProvider.pin({
        distDir,
        cid: 'bafytest',
        token: secretToken,
        fetchFn: mockFetch as unknown as typeof fetch,
      });
    } catch (err) {
      errorCaught = err as Error;
    }

    expect(errorCaught).not.toBeNull();
    // Crucial rule: Never leak or print secret token in error message
    expect(errorCaught?.message).not.toContain(secretToken);
    expect(errorCaught?.message).toContain('HTTP status 401');
  });

  it('documents free-tier limits referencing provider current page', () => {
    const notes = pinataProvider.getFreeTierNotes();
    expect(notes.toLowerCase()).toContain("check the provider's current page");
  });
});
