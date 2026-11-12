// Resolves a deploy CLI from deploy/cli's lockfile. Callers must not fall
// back to PATH or npx: an unpinned binary is a different program.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = new Set(['railway', 'vercel', 'wrangler']);

export function pinnedDeployCli(name) {
  if (!NAMES.has(name)) {
    throw new Error(`unknown deploy CLI: ${name}`);
  }
  const bin = join(REPO, 'deploy/cli/node_modules/.bin', name);
  if (!existsSync(bin)) {
    throw new Error(
      `${name} is not installed from the pinned lockfile. Run npm ci in deploy/cli.`,
    );
  }
  return bin;
}
