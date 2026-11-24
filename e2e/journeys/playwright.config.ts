import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from './playwright.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Physical journey gate. Expects the local stack already running:
 * Postgres (pgvector), Redis, API :4000, worker, web :5173 with
 * VITE_AUTH_MODE=stub and VITE_ENABLE_E2E_ROLE_HEADER=true.
 * No external keys. Point E2E_BASE_URL elsewhere to reuse a different web.
 */
export default defineConfig({
  testDir: here,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: path.join(here, 'results.json') }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'desktop-1280',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
