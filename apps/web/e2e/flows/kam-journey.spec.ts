/**
 * kam-journey.spec.ts
 *
 * WHY: Initiative → Lead → Opportunity is the flagship KAM flow (docs/KAM-PLAN.md
 * §0/§3.2) — a workshop lead is tracked to a qualified deal and handed off to
 * OM in one guarded transaction. The API side is covered by
 * kam-initiatives.integration.test.ts; this spec proves the same locked state
 * machine end-to-end through the actual cockpit UI (designate → transition
 * buttons), not just the route handler.
 *
 * GAP (see assertions below): the cockpit (kamPanels.tsx) has no "create
 * initiative" form — KamInitiativeBoard only lists and transitions initiatives
 * that already exist. We seed the initiative through the canonical write route
 * directly (same one a future form would call) so the rest of the journey
 * (designate, initiative→lead, lead→opportunity) can be driven through the UI
 * as a real user would. The mint is verified via the API rather than the OM
 * handoffs card on the same page — useTransitionInitiative's onSuccess
 * invalidates kam-initiatives/kam-account-kpi/kam-todos but not kam-handoffs
 * (useKam.ts), so the handoffs list visibly goes stale until the next full
 * mount/reload — a minor real gap, not asserted here to keep this spec
 * deterministic.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';

async function createCompany(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/v1/companies', {
    data: {
      name,
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
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function createInitiative(page: Page, companyId: string, title: string): Promise<string> {
  const res = await page.request.post('/api/v1/kam/initiatives', {
    data: { companyId, title, estimatedValueMicros: 250_000_000 },
    timeout: 10_000,
  });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function getInitiative(
  page: Page,
  id: string,
): Promise<{ stage: string; convertedToOpportunityId: string | null }> {
  const res = await page.request.get(`/api/v1/kam/initiatives/${id}`, { timeout: 10_000 });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function softDelete(page: Page, path: string): Promise<void> {
  const res = await page.request.delete(path, { timeout: 10_000 });
  expect(res.ok() || res.status() === 404).toBe(true);
}

/** The InitiativeCard for `title` within a given stage region (kamPanels.tsx has no data-testid on cards). */
function cardIn(region: Locator, title: string): Locator {
  return region.locator('div', { hasText: title }).first();
}

test.describe('KAM journey — Initiative → Lead → Opportunity', () => {
  test('designate a key account, then drive an initiative through the locked state machine via the UI', async ({
    page,
  }) => {
    const stamp = Date.now();
    const companyName = `E2E KAM Co ${stamp}`;
    const initiativeTitle = `E2E KAM Initiative ${stamp}`;

    const companyId = await createCompany(page, companyName);
    const initiativeId = await createInitiative(page, companyId, initiativeTitle);
    let opportunityId: string | null = null;

    try {
      await page.goto('/kam', { waitUntil: 'load' });
      await expect(
        page.getByRole('heading', { name: 'Key Account Management', level: 1 }),
      ).toBeVisible({ timeout: 15_000 });

      // ── Designate the seeded company as a key account (real UI affordance) ──
      await page
        .getByRole('button', { name: /designate/i })
        .first()
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder(/search companies/i).fill(companyName);
      const candidate = dialog.getByRole('option', { name: companyName });
      await expect(candidate).toBeVisible({ timeout: 10_000 });
      await candidate.click();
      await dialog.getByRole('button', { name: /designate key account/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 10_000 });

      await expect(page.getByRole('heading', { name: companyName, level: 2 })).toBeVisible({
        timeout: 15_000,
      });

      const initiativesRegion = page.getByRole('region', { name: 'Initiatives' });
      const leadsRegion = page.getByRole('region', { name: 'Leads' });
      const opportunitiesRegion = page.getByRole('region', { name: 'Opportunities' });

      // ── Stage 1: initiative → lead (guarded transition button) ──
      await expect(cardIn(initiativesRegion, initiativeTitle)).toBeVisible({ timeout: 15_000 });
      await cardIn(initiativesRegion, initiativeTitle)
        .getByRole('button', { name: /Lead/ })
        .click();
      await expect(cardIn(leadsRegion, initiativeTitle)).toBeVisible({ timeout: 15_000 });
      await expect(initiativesRegion.getByText(initiativeTitle)).toHaveCount(0);

      // ── Stage 2: lead → opportunity — mints a real Opportunity + KamHandoff
      // in one transaction (kam-initiatives.ts transition route, §3.2). ──
      await cardIn(leadsRegion, initiativeTitle)
        .getByRole('button', { name: /Opportunity/ })
        .click();
      await expect(cardIn(opportunitiesRegion, initiativeTitle)).toBeVisible({ timeout: 15_000 });
      await expect(leadsRegion.getByText(initiativeTitle)).toHaveCount(0);

      // The board move must reflect a REAL server-side mint, not a UI-only
      // stage flip — verify the initiative + minted Opportunity through the API.
      const detail = await getInitiative(page, initiativeId);
      expect(detail.stage).toBe('opportunity');
      expect(detail.convertedToOpportunityId).toBeTruthy();
      opportunityId = detail.convertedToOpportunityId;
      const oppRes = await page.request.get(`/api/v1/opportunities/${opportunityId}`, {
        timeout: 10_000,
      });
      expect(oppRes.ok()).toBe(true);
      const opp = (await oppRes.json()) as { name: string };
      expect(opp.name).toBe(initiativeTitle);
    } finally {
      if (opportunityId) await softDelete(page, `/api/v1/opportunities/${opportunityId}`);
      await softDelete(page, `/api/v1/kam/initiatives/${initiativeId}`);
      await softDelete(page, `/api/v1/companies/${companyId}`);
    }
  });
});
