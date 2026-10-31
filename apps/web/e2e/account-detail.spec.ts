import { test, expect } from './fixtures.js';
import type { APIRequestContext, Page } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';

type DashboardSnapshot = {
  cockpit: {
    company: {
      id: string;
      name: string;
      domain?: string | null;
    };
  };
  companies: Array<{
    id: string;
    name: string;
    domain?: string | null;
  }>;
};

async function fetchDashboardSnapshot(request: APIRequestContext): Promise<DashboardSnapshot> {
  const response = await request.get(`${API_URL}/api/v1/crm/dashboard`);
  expect(response.ok(), 'dashboard endpoint must respond').toBeTruthy();
  return (await response.json()) as DashboardSnapshot;
}

async function fetchAccountSnapshot(request: APIRequestContext): Promise<{
  accountId: string;
  snapshot: DashboardSnapshot;
}> {
  const baseline = await fetchDashboardSnapshot(request);
  const target = baseline.companies.find((company) => company.id !== baseline.cockpit.company.id)
    ?? baseline.companies[0]
    ?? baseline.cockpit.company;
  const response = await request.get(
    `${API_URL}/api/v1/crm/dashboard?account=${encodeURIComponent(target.id)}`,
  );
  expect(response.ok(), 'target account dashboard endpoint must respond').toBeTruthy();
  const snapshot = (await response.json()) as DashboardSnapshot;
  expect(snapshot.cockpit.company.id, 'dashboard must resolve the requested account id').toBe(
    target.id,
  );
  return { accountId: target.id, snapshot };
}

// The account page shows a short top level (header + key numbers, signals,
// pipeline/relationship visuals, agreements) and folds the full cockpit behind
// "Account details" (progressive disclosure, Tony 2026-10-31 15:21 BRT).
async function expectAccountCockpitReady(page: Page, companyName: string) {
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: companyName })).toBeVisible({
    timeout: 30_000,
  });
  await expect(main.getByRole('group', { name: 'Key numbers' })).toBeVisible({ timeout: 30_000 });
}

async function openAccountDetails(page: Page) {
  const fold = page.getByRole('main').getByRole('button', { name: /^Account details/ });
  await expect(fold).toBeVisible({ timeout: 15_000 });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
}

test('target account renders a scoped, trustworthy cockpit', async ({ page, gotoAndWait }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const { accountId, snapshot } = await fetchAccountSnapshot(page.request);
  const company = snapshot.cockpit.company;

  await gotoAndWait(`/accounts/${accountId}`);

  await expectAccountCockpitReady(page, company.name);
  if (company.domain) {
    await expect(page.getByText(company.domain, { exact: false }).first()).toBeVisible();
  }

  // Top level: simple, every number drills in.
  await expect(page.getByTestId('account-visuals')).toBeVisible();
  await expect(page.getByTestId('account-agreements-card')).toBeVisible();
  // Depth: the full cockpit behind the fold. The command-center hero is
  // org-dashboard only (it repeated the account header).
  await openAccountDetails(page);
  await expect(page.getByRole('region', { name: 'Account metrics' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Portfolio pipeline by stage' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Account opportunities' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Account signal coverage' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Account intelligence views' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Portfolio sales intelligence')).toBeVisible({ timeout: 15_000 });
  // 'Source coverage' lives in the org-only command center; the account's own
  // coverage is the 'Account signal coverage' region above.

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(horizontalOverflow, 'account detail must not create horizontal page overflow').toBe(false);
  expect(errors, 'account detail should not emit page or console errors').toEqual([]);
});

test('account intelligence tabs are keyboard-operable', async ({ page, gotoAndWait }) => {
  const { accountId } = await fetchAccountSnapshot(page.request);
  await gotoAndWait(`/accounts/${accountId}`);
  await openAccountDetails(page);

  const tablist = page.getByRole('tablist', { name: 'Account intelligence views' });
  await expect(tablist).toBeVisible({ timeout: 15_000 });

  const solutions = page.getByRole('tab', { name: /Solutions/ });
  const products = page.getByRole('tab', { name: /Products/ });
  const extractions = page.getByRole('tab', { name: /Extractions/ });

  await solutions.focus();
  await expect(solutions).toHaveAttribute('aria-selected', 'true');
  await solutions.press('ArrowRight');
  await expect(products).toHaveAttribute('aria-selected', 'true');
  await products.press('End');
  await expect(extractions).toHaveAttribute('aria-selected', 'true');
  await extractions.press('Home');
  await expect(solutions).toHaveAttribute('aria-selected', 'true');
});

test('mobile account workspace stays navigable without overflow', async ({ page, gotoAndWait }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { accountId, snapshot } = await fetchAccountSnapshot(page.request);
  await gotoAndWait(`/accounts/${accountId}`);

  await expectAccountCockpitReady(page, snapshot.cockpit.company.name);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(horizontalOverflow, 'mobile account detail must not overflow horizontally').toBe(false);

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Primary navigation' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Accounts', exact: true })
    .click();
  await expect(page).toHaveURL(/\/accounts$/);
});
