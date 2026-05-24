import path from 'node:path';
import dotenvFlow from 'dotenv-flow';
import { defineConfig } from 'vitest/config';

// Load env from repo root so REDIS_URL is available to BullMQ probes regardless
// of which cwd vitest is launched from.
dotenvFlow.config({ path: path.resolve(__dirname, '../..'), silent: true });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
    // Use child_process forks instead of worker_threads so tests that spawn
    // their own worker_threads (the document-extract sandbox) don't fight
    // with vitest's own thread isolation.
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
    },
  },
});
