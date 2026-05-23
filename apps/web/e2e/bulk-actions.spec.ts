import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';
const DATA_READY_TIMEOUT_MS = 30_000;

test.describe.configure({ mode: 'serial' });

function selectAllCheckbox(page: Page) {
  return page.getByRole('checkbox', { name: /Select all|Deselect all/i });
}

function rowCheckboxes(page: Page) {
  return page.getByRole('checkbox', {
    name: /^Select (?!all|none)/i,
  });
}

async function expectBulkTableReady(page: Page) {
  await expect(selectAllCheckbox(page)).toBeVisible({ timeout: DATA_READY_TIMEOUT_MS });
}

async function ensureCompanyFixture(request: APIRequestContext) {
  const name = 'E2E Bulk Company';
  const existing = await request.get(
    `${API_URL}/api/v1/companies?search=${encodeURIComponent(name)}&limit=1`,
  );
  expect(existing.ok(), 'companies fixture lookup must respond').toBeTruthy();
  const body = (await existing.json()) as { items: unknown[] };
  if (body.items.length > 0) return;

  const created = await request.post(`${API_URL}/api/v1/companies`, {
    data: {
      name,
      legalName: null,
      domain: 'e2e-bulk-company.example',
      industry: 'Testing',
      employeeCount: 42,
      countryCode: 'US',
      address: null,
      billingEmail: null,
      taxId: null,
      logoUrl: null,
      website: 'https://e2e-bulk-company.example',
      tier: 'standard',
    },
  });
  expect(created.ok(), 'companies bulk E2E fixture must be creatable').toBeTruthy();
}

async function ensureLeadFixture(request: APIRequestContext) {
  const companyName = 'E2E Bulk Lead Account';
  const existing = await request.get(
    `${API_URL}/api/v1/leads?search=${encodeURIComponent(companyName)}&limit=1`,
  );
  expect(existing.ok(), 'leads fixture lookup must respond').toBeTruthy();
  const body = (await existing.json()) as { items: unknown[] };
  if (body.items.length > 0) return;

  const created = await request.post(`${API_URL}/api/v1/leads`, {
    data: {
      firstName: 'E2E',
      lastName: 'Bulk',
      email: 'e2e.bulk@example.com',
      companyName,
      title: 'Procurement Lead',
      source: 'website',
      priority: 'medium',
      score: 50,
    },
  });
  expect(created.ok(), 'leads bulk E2E fixture must be creatable').toBeTruthy();
}

test.describe('Bulk actions - Companies', () => {
  test('select-all checkbox is present', async ({ page, gotoAndWait }) => {
    await ensureCompanyFixture(page.request);
    await gotoAndWait('/companies');

    await expectBulkTableReady(page);
  });

  test('bulk action bar appears after selecting a company', async ({ page, gotoAndWait }) => {
    await ensureCompanyFixture(page.request);
    await gotoAndWait('/companies');
    await expectBulkTableReady(page);

    await rowCheckboxes(page).first().check();

    await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export selected' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete selected' })).toBeVisible();
  });

  test('bulk action bar disappears after clearing selection', async ({ page, gotoAndWait }) => {
    await ensureCompanyFixture(page.request);
    await gotoAndWait('/companies');
    await expectBulkTableReady(page);

    await rowCheckboxes(page).first().check();
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByRole('region', { name: 'Bulk actions' })).not.toBeVisible();
  });
});

test.describe('Bulk actions - Leads', () => {
  test('select-all checkbox is present', async ({ page, gotoAndWait }) => {
    await ensureLeadFixture(page.request);
    await gotoAndWait('/leads');

    await expectBulkTableReady(page);
  });

  test('bulk action bar appears after selecting a lead', async ({ page, gotoAndWait }) => {
    await ensureLeadFixture(page.request);
    await gotoAndWait('/leads');
    await expectBulkTableReady(page);

    await rowCheckboxes(page).first().check();

    await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible();
  });
});
