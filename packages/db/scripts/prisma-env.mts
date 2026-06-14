// Run any `prisma` subcommand with the monorepo's root .env loaded.
//
// WHY: the Prisma CLI only auto-loads a .env next to the schema (packages/db),
// but DATABASE_URL lives in the repo-root .env (loaded everywhere else via
// dotenv-flow). Without this, `prisma migrate deploy` fails P1012. This mirrors
// seed.ts's env bootstrap, then execs prisma with the resolved env inherited —
// the connection string is never printed.
//
// Usage:  tsx scripts/prisma-env.mts migrate status
//         tsx scripts/prisma-env.mts migrate deploy
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenvFlow from 'dotenv-flow';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const packageDir = path.resolve(here, '..');

dotenvFlow.config({ path: repoRoot, silent: true });

if (!process.env.DATABASE_URL) {
  console.error(`DATABASE_URL not found after loading .env from ${repoRoot}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: tsx scripts/prisma-env.mts <prisma subcommand...>');
  process.exit(1);
}

// shell: true so Windows resolves pnpm.cmd. Args are a fixed prisma subcommand
// passed by the developer, not untrusted input.
execSync(`pnpm exec prisma ${args.join(' ')}`, {
  stdio: 'inherit',
  env: process.env,
  cwd: packageDir,
});
