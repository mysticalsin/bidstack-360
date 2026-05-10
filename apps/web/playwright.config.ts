import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4173);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

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
  // Boot the production preview against the already-running API+DB.
  // The API at http://localhost:4000 is *not* started here — that requires
  // docker compose + migrate + seed and stays a manual local prereq.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm preview --host 127.0.0.1 --port 4173',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
