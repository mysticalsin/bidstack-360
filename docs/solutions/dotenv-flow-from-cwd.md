# dotenv-flow loads from cwd, not the workspace root

**Problem:** Booting `apps/api`, `apps/mcp-server`, or `apps/worker` from inside
their own directory (or via `tsx` from a non-root cwd) silently failed to load
the repo-root `.env`. Prisma then exploded with
`Environment variable not found: DATABASE_URL`, and Stripe/Clerk/etc. fallbacks
masked the cause for several minutes of head-scratching.

**Diagnosis:** `dotenv-flow` (and `dotenv`, and `dotenvx`) resolves `.env` files
relative to `process.cwd()`. In a pnpm workspace where each app's `dev` script
runs `tsx watch src/main.ts` from `apps/<name>/`, the cwd is the app dir — so
the loader looks at `apps/api/.env`, doesn't find it, and goes silent. The repo
keeps a single `.env` at the root.

**Fix:** load explicitly from the repo root via `path.resolve` derived from the
file's own `import.meta.url`, instead of relying on cwd. Pattern, applied in
`apps/api/src/main.ts`, `apps/mcp-server/src/main.ts`, and
`apps/worker/src/main.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenvFlow from 'dotenv-flow';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Each app entry lives at apps/<name>/src/main.ts → root is three up.
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });
```

For Vitest the same trick goes in the per-app `vitest.config.ts` so test runs
also see the env (see `apps/api/vitest.config.ts`).

**Why it works:** `import.meta.url` is the absolute file URL of the module
itself, so the resolution is independent of where the process was started.
`silent: true` suppresses the spam when an optional `.env.<env>` doesn't
exist.

**Prevention:**

1. Every new long-running process (worker, server, MCP) gets the same three
   lines at the very top of its entry file. Treat `dotenv-flow/config` (the
   side-effect import that uses cwd) as **forbidden** in this repo.
2. The pre-commit `scan-secrets.sh` hook already blocks committing the `.env`
   itself, so root-only is safe.
