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
    env: {
      NODE_ENV: 'test',
    },
  },
});
