import { test, expect } from './fixtures.js';
import type { APIRequestContext, Page } from '@playwright/test';

// NOTE: Dark-mode toggle test lives in smoke.spec.ts — do NOT duplicate it here.

test.describe('Settings page', () => {
  const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:4010';

  async function openAppearance(page: Page, gotoAndWait: (path: string) => Promise<void>) {
    await gotoAndWait('/settings');
    await page.getByRole('link', { name: 'Appearance & Language' }).click();
  }

  async function getCuratedTopAccountIds(request: APIRequestContext): Promise<string[]> {
    const res = await request.get(`${apiUrl}/api/v1/accounts/top?limit=10`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      source: 'curated' | 'auto';
      items: Array<{ id: string }>;
    };
    return body.source === 'curated' ? body.items.map((item) => item.id) : [];
  }

  async function replaceTopAccountIds(request: APIRequestContext, companyIds: string[]) {
    const res = await request.put(`${apiUrl}/api/v1/accounts/top-list`, {
      data: { companyIds },
    });
    expect(res.ok()).toBeTruthy();
  }

  async function getOrgLocale(request: APIRequestContext) {
    const res = await request.get(`${apiUrl}/api/v1/org-settings/locale`);
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as {
      currency: string;
      dateFormat: string;
      timezone: string;
    };
  }

  async function replaceOrgLocale(
    request: APIRequestContext,
    locale: { currency: string; dateFormat: string; timezone: string },
  ) {
    const res = await request.put(`${apiUrl}/api/v1/org-settings/locale`, {
      data: locale,
    });
    expect(res.ok()).toBeTruthy();
  }

  test('page heading is visible', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });

  test('Appearance section is rendered', async ({ page, gotoAndWait }) => {
    await openAppearance(page, gotoAndWait);
    await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible();
    // Theme radio options
    await expect(page.getByRole('radio', { name: 'Light' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
  });

  test('Density section is rendered', async ({ page, gotoAndWait }) => {
    await openAppearance(page, gotoAndWait);
    await expect(page.getByRole('heading', { name: 'Density' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Compact' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Comfortable' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Spacious' })).toBeVisible();
  });

  test('Motion section is rendered', async ({ page, gotoAndWait }) => {
    await openAppearance(page, gotoAndWait);
    await expect(page.getByRole('heading', { name: 'Motion' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'System' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Full motion' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Reduced' })).toBeVisible();
  });

  test('visual effects preference persists after navigation', async ({ page, gotoAndWait }) => {
    await openAppearance(page, gotoAndWait);
    const visualEffects = page.getByRole('checkbox', { name: 'Premium visual effects' });

    await visualEffects.check();
    await visualEffects.uncheck();
    await expect(visualEffects).not.toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-visual-effects', 'off');

    await page.reload();
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-visual-effects', 'off');
    await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible();

    const persistedVisualEffects = page.getByRole('checkbox', {
      name: 'Premium visual effects',
    });
    await expect(persistedVisualEffects).not.toBeChecked();

    await persistedVisualEffects.check();
  });

  test('density selection is persisted via radio state', async ({ page, gotoAndWait }) => {
    await openAppearance(page, gotoAndWait);
    const spacious = page.getByRole('radio', { name: 'Spacious' });
    await spacious.click();
    await expect(spacious).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'spacious');
    // Restore to comfortable so we don't affect other tests
    await page.getByRole('radio', { name: 'Comfortable' }).click();
  });

  test('Top Accounts curation persists through the server-backed settings flow', async ({
    page,
    request,
    gotoAndWait,
  }) => {
    const companiesRes = await request.get(`${apiUrl}/api/v1/companies`);
    expect(companiesRes.ok()).toBeTruthy();
    const companiesBody = (await companiesRes.json()) as {
      items: Array<{ id: string; name: string }>;
    };
    const company = companiesBody.items[0];
    test.skip(!company, 'Seed database has no companies to curate');

    const originalIds = await getCuratedTopAccountIds(request);
    try {
      await replaceTopAccountIds(request, []);

      await gotoAndWait('/settings?tab=top-accounts');
      await expect(page.getByRole('heading', { name: 'Top accounts', level: 2 })).toBeVisible();
      await expect(page.getByText('No curated accounts yet')).toBeVisible();

      await page
        .getByRole('searchbox', { name: 'Search companies to add to the top accounts' })
        .fill(company.name);
      await page
        .getByRole('button', { name: new RegExp(company.name) })
        .first()
        .click();
      await expect(page.getByLabel('Curated top accounts, in rank order')).toContainText(
        company.name,
      );

      await page.getByRole('button', { name: 'Save top accounts' }).click();
      await expect(page.getByRole('button', { name: 'Save top accounts' })).toBeDisabled();

      const persisted = await request.get(`${apiUrl}/api/v1/accounts/top?limit=10`);
      expect(persisted.ok()).toBeTruthy();
      const persistedBody = (await persisted.json()) as {
        source: 'curated' | 'auto';
        items: Array<{ id: string }>;
      };
      expect(persistedBody.source).toBe('curated');
      expect(persistedBody.items[0]?.id).toBe(company.id);
    } finally {
      await replaceTopAccountIds(request, originalIds);
    }
  });

  test('Currency and locale workspace defaults persist through the server-backed settings flow', async ({
    page,
    request,
    gotoAndWait,
  }) => {
    const original = await getOrgLocale(request);
    try {
      await replaceOrgLocale(request, {
        currency: 'CAD',
        dateFormat: 'YYYY-MM-DD',
        timezone: 'America/Toronto',
      });

      await gotoAndWait('/settings?tab=workspace');
      await expect(page.getByRole('heading', { name: 'Currency & locale' })).toBeVisible();
      await page.getByLabel('Default currency').selectOption('USD');
      await page.getByLabel('Date format').selectOption('MM/DD/YYYY');
      await page.getByLabel('Timezone').selectOption('America/New_York');
      const saveResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/org-settings/locale') &&
          response.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: 'Save currency and locale' }).click();
      expect((await saveResponse).ok()).toBe(true);
      await expect(page.getByText('Currency and locale saved')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save currency and locale' })).toBeDisabled();

      const persisted = await getOrgLocale(request);
      expect(persisted).toEqual({
        currency: 'USD',
        dateFormat: 'MM/DD/YYYY',
        timezone: 'America/New_York',
      });
    } finally {
      await replaceOrgLocale(request, original);
    }
  });
});
