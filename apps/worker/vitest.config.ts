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
    // Contract suites seed/clean real DB fixtures in beforeAll/afterAll; on a
    // Windows host against dockerized Postgres those hooks can exceed vitest's
    // 10s default under load (observed: tenant-export afterAll cleanup flake).
    hookTimeout: 120_000,
    // Use threads instead of child-process forks. The worker package tests
    // spawn their own sandbox worker_threads, and Tinypool's fork IPC can fail
    // with ERR_IPC_CHANNEL_CLOSED on Windows after all assertions pass.
    pool: 'threads',
    fileParallelism: false,
    isolate: false,
    env: {
      NODE_ENV: 'test',
    },
  },
});
