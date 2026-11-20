import path from 'node:path';
import dotenvFlow from 'dotenv-flow';
import { loadTestEnv } from '../../scripts/load-test-env.mjs';
import { defineConfig } from 'vitest/config';

// Load env from repo root so REDIS_URL is available to BullMQ probes regardless
// of which cwd vitest is launched from.
loadTestEnv(dotenvFlow, path.resolve(__dirname, '../..'));

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
    // Each file installs its own SERUM and Prisma mocks. Sharing one module
    // graph made a later file's gate spy miss the function the handler calls,
    // so a denial never ran and the assertions looked like the gate was gone.
    isolate: true,
    env: {
      NODE_ENV: 'test',
      // In-process refreshes. The opt-out is honored only because NODE_ENV is
      // test. Production and a missing NODE_ENV still require Redis.
      OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
    },
  },
});
