import { defineConfig, devices } from '@playwright/test';

const portOffset = Number(process.env.E2E_PORT_OFFSET ?? 0);
const PORT = Number(process.env.E2E_WEB_PORT ?? process.env.PORT ?? 4174 + portOffset);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4010 + portOffset);
const DOCUMENT_WORKER_PORT = Number(
  process.env.E2E_DOCUMENT_WORKER_HEALTH_PORT ?? 4910 + portOffset,
);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const API_URL = process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`;
process.env.E2E_API_URL = API_URL;
const authMode = process.env.E2E_AUTH_MODE ?? process.env.VITE_AUTH_MODE ?? 'stub';
process.env.E2E_AUTH_MODE = authMode;
process.env.VITE_AUTH_MODE = authMode;
const e2eRedisUrl = process.env.E2E_REDIS_URL ?? process.env.REDIS_URL;
if (e2eRedisUrl) process.env.REDIS_URL = e2eRedisUrl;
process.env.E2E_DOCUMENT_WORKER_HEALTH_URL = `http://127.0.0.1:${DOCUMENT_WORKER_PORT}/health`;
const documentWorkerOcrEnabled =
  process.env.BIDSTACK_OCR_ENABLED ?? (process.env.E2E_DOCUMENT_WORKER_OCR === '1' ? 'true' : 'false');
process.env.BIDSTACK_OCR_ENABLED = documentWorkerOcrEnabled;
const reuseExistingServer = process.env.E2E_REUSE_SERVER === '1' && !process.env.CI;
const startManagedDocumentWorker =
  process.env.E2E_DOCUMENT_WORKER === '1' && process.env.E2E_DOCUMENT_WORKER_EXTERNAL !== '1';
const webEnv = [
  'BIDSTACK_ALLOW_STUB_AUTH=true',
  `VITE_AUTH_MODE=${authMode}`,
  'VITE_ENABLE_E2E_ROLE_HEADER=true',
  `VITE_API_URL=${API_URL}`,
  process.env.VITE_CLERK_PUBLISHABLE_KEY
    ? `VITE_CLERK_PUBLISHABLE_KEY=${process.env.VITE_CLERK_PUBLISHABLE_KEY}`
    : null,
].filter(Boolean).join(' ');
const apiEnv = [
  `PORT_API=${API_PORT}`,
  `PUBLIC_BASE_URL=${baseURL}`,
  `PUBLIC_API_URL=${API_URL}`,
  'BIDSTACK_ALLOW_STUB_ROLE_HEADER=true',
  'API_RATE_LIMIT_MAX=5000',
  'PUBLIC_BOOKING_RATE_LIMIT_MAX=5000',
  e2eRedisUrl ? `REDIS_URL=${e2eRedisUrl}` : null,
].filter(Boolean).join(' ');
const documentWorkerEnv = [
  `DOCUMENT_EXTRACT_WORKER_HEALTH_PORT=${DOCUMENT_WORKER_PORT}`,
  `REDIS_URL=${e2eRedisUrl ?? 'redis://localhost:6380'}`,
  `STORAGE_DRIVER=${process.env.STORAGE_DRIVER ?? 'local'}`,
  'RFP_LLM_PROVIDER=',
  `BIDSTACK_OCR_ENABLED=${documentWorkerOcrEnabled}`,
  `BIDSTACK_OCR_LANGUAGES=${process.env.BIDSTACK_OCR_LANGUAGES ?? 'eng'}`,
  `BIDSTACK_OCR_TIMEOUT_MS=${process.env.BIDSTACK_OCR_TIMEOUT_MS ?? '120000'}`,
].join(' ');
const workerCount = Number(process.env.E2E_WORKERS ?? 1);
const useStubAuthStorage =
  authMode === 'stub' && !process.env.VITE_CLERK_PUBLISHABLE_KEY;
const crossBrowserTestMatch = [
  '**/smoke.spec.ts',
  '**/navigation.spec.ts',
  '**/critical-controls.spec.ts',
  '**/accounts.spec.ts',
  '**/account-detail.spec.ts',
  '**/contacts.spec.ts',
  '**/opportunities.spec.ts',
  '**/pipeline.spec.ts',
  '**/search.spec.ts',
  '**/settings.spec.ts',
  '**/tasks.spec.ts',
  '**/service-desk.spec.ts',
  '**/flows/auth.spec.ts',
  '**/flows/rbac.spec.ts',
];

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
        command: `pnpm exec cross-env ${apiEnv} pnpm --filter @bidstack/api exec tsx src/main.ts`,
        url: `${API_URL}/health`,
        reuseExistingServer,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
      ...(startManagedDocumentWorker
        ? [
            {
              command: `pnpm exec cross-env ${documentWorkerEnv} pnpm --filter @bidstack/worker exec tsx src/e2e/document-extract-worker.ts`,
              url: process.env.E2E_DOCUMENT_WORKER_HEALTH_URL,
              reuseExistingServer: false,
              timeout: 120_000,
              stdout: 'pipe' as const,
              stderr: 'pipe' as const,
            },
          ]
        : []),
      // 2. Boot the web production preview.
      {
        command: [
          'pnpm --filter @bidstack/shared build',
          `pnpm exec cross-env NODE_ENV=production ${webEnv} pnpm --filter @bidstack/web exec tsc -b`,
          `pnpm exec cross-env NODE_ENV=production ${webEnv} pnpm --filter @bidstack/web exec vite build`,
          `pnpm exec cross-env ${webEnv} pnpm --filter @bidstack/web exec vite preview --host 127.0.0.1 --port ${PORT}`,
        ].join(' && '),
        url: baseURL,
        reuseExistingServer,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    ];

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Performance budgets are part of the normal E2E gate, so the default run
  // must be deterministic. Developers can opt into faster non-gate runs with
  // E2E_WORKERS=2+ when they are not measuring Core Web Vitals.
  workers: workerCount,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    storageState: useStubAuthStorage
      ? {
          cookies: [],
          origins: [
            {
              origin: baseURL,
              localStorage: [{ name: 'bidstack:session', value: 'stub' }],
            },
          ],
        }
      : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox-desktop',
      testMatch: crossBrowserTestMatch,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-desktop',
      testMatch: crossBrowserTestMatch,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: servers,
});
