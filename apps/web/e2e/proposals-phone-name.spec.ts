import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

/**
 * On a phone the proposals table is `table-fixed` with explicit column widths.
 * Those widths use up the row, the name column collapses to 0, and the stage
 * cell is painted on the same x as the name. A normal click then hits "Draft"
 * instead of the proposal. Force-click would hide that. This spec does not.
 */
test.use({ viewport: { width: 390, height: 844 } });

function proposalsApiUrl(path: string): string {
  const base = (process.env.E2E_API_URL ?? '').replace(/\/$/, '');
  return `${base}${path}`;
}

test('a normal click on the proposal name opens it on a phone', async ({ page, gotoAndWait }) => {
  const stamp = `PhoneName${Date.now()}`;
  const name = `${stamp} Northwind platform proposal`;
  const created = await seedProposal(page, name);

  try {
    await gotoAndWait(`/proposals?q=${encodeURIComponent(stamp)}`);
    const link = page.getByRole('link', { name });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/proposals/${created.id}$`));
    await expect(page.getByRole('heading', { name })).toBeVisible();
  } finally {
    await page.request.delete(proposalsApiUrl(`/api/v1/proposals/${created.id}`)).catch(() => undefined);
  }
});

async function seedProposal(page: Page, name: string): Promise<{ id: string; name: string }> {
  const res = await page.request.post(proposalsApiUrl('/api/v1/proposals'), {
    data: { name },
    timeout: 15_000,
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: string; name: string };
}
