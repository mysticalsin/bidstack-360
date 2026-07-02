import { defineConfig } from 'vitest/config';
import path from 'node:path';
import dotenvFlow from 'dotenv-flow';

// Load .env from repo root before tests run so DATABASE_URL is set when
// integration tests probe Postgres.
dotenvFlow.config({ path: path.resolve(__dirname, '../..'), silent: true });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
    // Integration suites seed a full isolated org in beforeAll (~18s on a
    // Windows host against dockerized Postgres, longer under load). Vitest's
    // 10s default hookTimeout kills those hooks mid-seed and the suite dies
    // with a misleading "Hook timed out" at the SELECT 1 line.
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
      },
    },
  },
});
