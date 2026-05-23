import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures.js';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';

test.describe.configure({ mode: 'serial' });

async function ensureServiceCaseFixture(request: APIRequestContext) {
  const subject = 'E2E Service Case';
  const existing = await request.get(
    `${API_URL}/api/v1/service-cases?search=${encodeURIComponent(subject)}&limit=1`,
  );
  expect(existing.ok(), 'service case fixture lookup must respond').toBeTruthy();
  const body = (await existing.json()) as { items: unknown[] };
  if (body.items.length > 0) return;

  const created = await request.post(`${API_URL}/api/v1/service-cases`, {
    data: {
      subject,
      description: 'Created by Playwright to prove the service desk table and row links.',
      priority: 'medium',
      status: 'new',
      accountId: null,
      contactId: null,
      ownerId: null,
      source: 'web',
      satisfaction: null,
      slaDeadline: null,
    },
  });
  expect(created.ok(), 'service case E2E fixture must be creatable').toBeTruthy();
}

test.describe('Service Desk page', () => {
  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/service-desk');
    await expect(page.getByRole('heading', { name: 'Service Desk', level: 1 })).toBeVisible();
  });

  test('filter controls are rendered', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/service-desk');
    await expect(page.getByPlaceholder(/Search cases/)).toBeVisible();
    await expect(page.locator('select').first()).toBeVisible();
  });

  test('case list or empty state is shown', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/service-desk');
    const table = page.locator('table');
    const emptyState = page.getByText(/No cases yet/i);
    await expect(table.or(emptyState).first()).toBeVisible();
  });

  test('table column headers are present when data exists', async ({ page, gotoAndWait }) => {
    await ensureServiceCaseFixture(page.request);
    await gotoAndWait('/service-desk');

    await expect(page.locator('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Subject' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Priority' })).toBeVisible();
  });

  test('case rows link to detail page', async ({ page, gotoAndWait }) => {
    await ensureServiceCaseFixture(page.request);
    await gotoAndWait('/service-desk');

    const caseLinks = page.locator('a[href^="/service-desk/"]');
    await expect(caseLinks.first()).toBeVisible();
  });
});
