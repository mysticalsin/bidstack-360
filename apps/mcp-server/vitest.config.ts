import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenvFlow from 'dotenv-flow';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load env from the repo root so DATABASE_URL/REDIS_URL are available without
// the test runner being launched from the right cwd.
dotenvFlow.config({ path: path.resolve(__dirname, '../..'), silent: true });

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
});
