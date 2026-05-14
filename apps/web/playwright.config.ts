import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4173);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

/**
 * Fully automatic E2E orchestration.
 *
 * When E2E_BASE_URL is not set, Playwright starts both the API dev server
 * and the Vite production preview in sequence, waiting for each to be
 * healthy before proceeding. This makes `pnpm e2e` a single-command
 * operation with no manual server management.
 *
 * Prerequisites (run once per DB reset):
 *   pnpm db:migrate && pnpm db:seed
 */
const servers = process.env.E2E_BASE_URL
  ? undefined
  : [
      // 1. Boot the API first so the web preview can hit endpoints immediately.
      {
        command: 'pnpm --filter @bidstack/api dev',
        url: `${API_URL}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
      // 2. Boot the web production preview.
      {
        command: `pnpm preview --host 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    ];

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: servers,
});
