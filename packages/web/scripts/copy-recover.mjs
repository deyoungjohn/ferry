// Serve the standalone recovery page from the site too. The same file lives in the repository
// root, so it can still be downloaded from GitHub when this site is down.
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../../recover.html', import.meta.url));
const target = fileURLToPath(new URL('../dist/recover.html', import.meta.url));
if (!existsSync(source)) {
  console.error('recover.html is missing from the repository root.');
  process.exit(1);
}
copyFileSync(source, target);
console.log('Copied recover.html into dist');
