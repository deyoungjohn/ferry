import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const outputPath = here('../../../recover.html');

/** Public endpoints per EVM chain id, from the recorded chain facts. */
async function rpcUrls() {
  const data = JSON.parse(
    await readFile(here('../../chain-config/src/data/chains.json'), 'utf8'),
  );
  const map = {};
  for (const chain of Object.values(data.chains)) {
    for (const network of [chain.mainnet, chain.testnet]) {
      if (!network?.chainId) continue;
      const urls = (network.rpcUrls ?? []).map((item) => item.url);
      if (urls.length > 0) map[network.chainId] = urls;
    }
  }
  return map;
}

export async function buildHtml() {
  const result = await build({
    entryPoints: [here('../src/main.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    conditions: ['ferry-source', 'import', 'module', 'default'],
    minify: true,
    legalComments: 'none',
    define: {
      __RPC_URLS__: JSON.stringify(await rpcUrls()),
      'process.env.NODE_ENV': '"production"',
    },
  });
  const js = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const css = await readFile(here('../src/recover.css'), 'utf8');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src https: wss: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; img-src data:" />
    <title>Ferry recovery</title>
    <!-- prettier-ignore -->
    <style>${css}</style>
  </head>
  <body>
    <div id="app"></div>
    <!-- prettier-ignore -->
    <script type="module">${js}</script>
  </body>
</html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = await buildHtml();
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = await readFile(outputPath, 'utf8');
    } catch {
      /* missing */
    }
    if (current !== html) {
      process.stderr.write(
        'recover.html is stale. Run `pnpm --filter @ferry/recover-page build` and commit the result.\n',
      );
      process.exitCode = 1;
    } else {
      process.stdout.write('recover.html matches a fresh build.\n');
    }
  } else {
    await writeFile(outputPath, html);
    process.stdout.write(`Wrote ${outputPath} (${html.length} bytes)\n`);
  }
}
