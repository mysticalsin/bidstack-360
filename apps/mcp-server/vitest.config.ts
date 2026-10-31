import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenvFlow from 'dotenv-flow';
import { loadTestEnv } from '../../scripts/load-test-env.mjs';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load env from the repo root so DATABASE_URL/REDIS_URL are available without
// the test runner being launched from the right cwd.
loadTestEnv(dotenvFlow, path.resolve(__dirname, '../..'));

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
});
