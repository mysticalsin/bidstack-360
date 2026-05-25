/**
 * mock-server.fixture.ts
 *
 * WHY: E2E must never hit real third-party APIs (Stripe, DocuSign, Gmail OAuth,
 * Dust). This fixture stubs them via route interception so tests are
 * deterministic, fast, and don't incur costs or rate-limit real services.
 *
 * Pattern: Playwright's page.route() intercepts matching requests and
 * responds with pre-defined JSON — equivalent to MSW but without a SW overhead
 * in the E2E context.
 */
import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Stub responses for each external service. */
async function installMocks(page: Page): Promise<void> {
  // Dust AI completions — return a stub draft so ai-assistant tests work.
  await page.route('**/api/v1/w/*/assistant/*/completions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'mock-run-1',
        status: 'succeeded',
        content: [{ type: 'text', text: 'E2E stub email draft from Dust mock.' }],
      }),
    });
  });

  // Dust run status
  await page.route('**/api/v1/w/*/runs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'succeeded', results: [] }),
    });
  });

  // Gmail OAuth callback — simulate successful connect
  await page.route('**/oauth/gmail/callback**', async (route) => {
    await route.fulfill({ status: 302, headers: { Location: '/integrations?connected=gmail' } });
  });

  // DocuSign envelope status
  await page.route('**/restapi/v2.1/accounts/*/envelopes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'sent', envelopeId: 'mock-envelope-001' }),
    });
  });

  // Stripe webhook verification
  await page.route('**/webhooks/stripe**', async (route) => {
    await route.fulfill({ status: 200, body: 'ok' });
  });

  // Apollo enrichment
  await page.route('**/api/v1/organizations/enrich**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ organization: { name: 'Stub Corp', domain: 'stub.example' } }),
    });
  });
}

export type MockFixtures = {
  /** Installs all third-party API mocks for the current page. */
  withMocks: () => Promise<void>;
};

export const test = base.extend<MockFixtures>({
  withMocks: async ({ page }, use) => {
    await use(async () => {
      await installMocks(page);
    });
  },
});

export { expect } from '@playwright/test';
