import path from 'node:path';

import dotenvFlow from 'dotenv-flow';
import { defineConfig } from 'vitest/config';

// Keep DB package integration tests aligned with apps/api: load the root env
// before Prisma constructs clients, but never print secret values.
dotenvFlow.config({ path: path.resolve(__dirname, '../..'), silent: true });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
    },
  },
});
