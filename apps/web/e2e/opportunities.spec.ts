import { test, expect } from './fixtures.js';

/**
 * WHY: opportunities.spec.ts only covered list/detail read paths — the actual
 * "+ New opportunity" create form (CreateOpportunityDialog.tsx) had no E2E
 * coverage. This is the primary write path into the pipeline, so a silent
 * regression here (e.g. a client-side validation schema drifting from the
 * form's fields) would block every new bid from being entered.
 *
 * HISTORY: this spec originally caught CreateOpportunityDialog omitting
 * `territoryId` from its candidate while OpportunityCreate requires it
 * (nullable, not optional) — every UI create silently no-oped. The dialog now
 * sends `territoryId: null`; this test guards against that class of
 * schema/form drift recurring.
 */
test('creating an opportunity via the UI form adds it to the list with the entered amount', async ({
  page,
  gotoAndWait,
}) => {
  const stamp = Date.now();
  const customerName = `E2E Opp Customer ${stamp}`;
  const opportunityName = `E2E Create Opp ${stamp}`;
  let createdId: string | null = null;

  // Seed a company so the Customer lookup (search-as-you-type) has a real
  // match to select — the dialog requires picking an option, not free text.
  const companyRes = await page.request.post('/api/v1/companies', {
    data: {
      name: customerName,
      legalName: null,
      domain: null,
      industry: null,
      employeeCount: null,
      countryCode: null,
      address: null,
      billingEmail: null,
      taxId: null,
      logoUrl: null,
      website: null,
    },
    timeout: 10_000,
  });
  expect(companyRes.ok(), await companyRes.text()).toBe(true);
  const companyId = (await companyRes.json()).id as string;

  try {
    await gotoAndWait('/opportunities');
    await expect(page.locator('h1')).toContainText('Opportunities', { timeout: 10_000 });

    await page
      .getByRole('button', { name: '+ New opportunity' })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('New opportunity')).toBeVisible({ timeout: 5_000 });

    const customerPicker = dialog.getByRole('combobox', { name: 'Customer' });
    await customerPicker.fill(customerName);
    const customerOption = dialog.getByRole('option', { name: customerName });
    await expect(customerOption).toBeVisible({ timeout: 10_000 });
    await customerOption.click();

    await dialog.locator('#name').fill(opportunityName);
    // `value` is whole EUR end-to-end on the wire (opportunity.ts: z.number()),
    // not micros — the list row renders it directly via formatMoney(value).
    // CLAUDE.md's micros convention applies to the separate *Micros fields
    // (e.g. estimatedValueMicros on KamInitiative), not this one.
    await dialog.locator('#value').fill('123000');

    await dialog.getByRole('button', { name: 'Create opportunity' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    const row = page.getByRole('row', { name: new RegExp(opportunityName) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    const link = row.getByRole('link', { name: opportunityName });
    const href = await link.getAttribute('href');
    createdId = href?.split('/').pop() ?? null;
    expect(createdId).toBeTruthy();

    // The list renders amounts in the viewer's display currency (stores/
    // currency.ts geo-detects it and converts with live hourly rates), so any
    // rendered-text assertion on the amount is rate- and locale-dependent.
    // Prove the entered amount round-tripped on the wire instead.
    const createdRes = await page.request.get(`/api/v1/opportunities/${createdId}`, {
      timeout: 10_000,
    });
    expect(createdRes.ok()).toBe(true);
    expect(((await createdRes.json()) as { value: number }).value).toBe(123_000);

    // Also appears in the pipeline kanban (same opportunity, second surface).
    await page.goto('/pipeline', { waitUntil: 'load' });
    await expect(
      page.locator(`[data-testid="pipeline-card"][data-opportunity-id="${createdId}"]`),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    if (createdId) {
      await page.request.delete(`/api/v1/opportunities/${createdId}`, { timeout: 10_000 });
    }
    await page.request.delete(`/api/v1/companies/${companyId}`, { timeout: 10_000 });
  }
});

test('opportunities list filters by stage', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/opportunities');
  await expect(page.locator('h1')).toContainText('Opportunities', { timeout: 10_000 });

  // Try clicking a canonical stage filter chip. It should exist and update
  // the current list without leaving the page.
  const stageFilter = page.getByRole('button', { name: /s1 lead|s1 ongoing|s2 sent/i }).first();
  await expect(stageFilter).toBeVisible({ timeout: 5_000 });
  await stageFilter.click();
  await expect(page.locator('#main')).toBeVisible();
});

test('opportunity detail shows activity tab', async ({ page, gotoAndWait }) => {
  await gotoAndWait('/opportunities');
  const firstLink = page.locator('a[href^="/opportunities/"]').first();
  await firstLink.click();
  await expect(page.locator('#main')).toBeVisible();

  // Intel ribbon should render.
  await expect(page.getByText(/win prediction|financial health|triggers/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // Activity or Tasks tab should be present.
  await expect(page.getByRole('tab', { name: /activity|tasks/i }).first()).toBeVisible({
    timeout: 10_000,
  });
});
