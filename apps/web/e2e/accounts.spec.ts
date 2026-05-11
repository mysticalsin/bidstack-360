// requires API on :4000 + web preview on the Playwright baseURL (config: :4173).
// The Playwright config auto-starts `pnpm preview` for the web app; the API
// must be running externally (docker compose + migrate + seed). If the API
// /health probe fails this whole file is skipped — same pattern as smoke.spec.ts.

import { test, expect, type Page, type Locator, request as pwRequest } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

let apiHealthy = false;

test.beforeAll(async () => {
  try {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${API_URL}/health`, { timeout: 2_000 });
    apiHealthy = res.ok();
    await ctx.dispose();
  } catch {
    apiHealthy = false;
  }
});

test.beforeEach(async () => {
  test.skip(!apiHealthy, `API at ${API_URL} not reachable — skipping accounts suite`);
});

/**
 * Resolve the first account card on the /accounts grid.
 *
 * We deliberately scope by role + accessible-name (`region` named "Account
 * cards" — see <section aria-label="Account cards"> in AccountsPage.tsx)
 * rather than CSS class, so a class rename can't silently make this test
 * pass against the wrong element.
 */
async function firstAccountCard(
  page: Page,
): Promise<{ card: Locator; name: string; href: string }> {
  const grid = page.getByRole('region', { name: /account cards/i });
  await expect(
    grid,
    'accounts grid region must render — proves the page mounted with data',
  ).toBeVisible();

  const card = grid.locator('a.account-card').first();
  await expect(
    card,
    'at least one account card must render — proves seeded data is present',
  ).toBeVisible();

  const href = await card.getAttribute('href');
  expect(href, 'card must link to a cockpit URL').toMatch(/^\/accounts\/.+/);

  // The card's first .account-card-name child holds the human-readable company name.
  const name = (await card.locator('.account-card-name').first().innerText()).trim();
  expect(
    name.length,
    'company name must be non-empty so the cockpit assertion is meaningful',
  ).toBeGreaterThan(0);

  return { card, name, href: href! };
}

test('accounts → cockpit drill-down renders all required surfaces', async ({ page }) => {
  // 1. Land on the accounts list.
  await page.goto('/accounts', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('main'), 'app shell must mount before we probe content').toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('heading', { level: 1, name: /^Accounts$/ })).toBeVisible({
    timeout: 10_000,
  });

  // 2. Verify ≥1 card rendered, then capture the company name + target URL.
  const { card, name, href } = await firstAccountCard(page);

  // 3. Drill in.
  await card.click();
  // 4. URL must reflect the chosen account — proves routing parsed the param.
  await expect(page, 'URL must navigate to the cockpit for the clicked card').toHaveURL(
    new RegExp(`${href.replace(/[/\\^$+?.()|[\]{}]/g, '\\$&')}$`),
  );

  // 5a. Cockpit header must show the company name we clicked on — proves the
  //     URL param actually drove the data fetch, not a stale render.
  await expect(
    page.getByRole('heading', { level: 1, name: new RegExp(`^${escapeRegex(name)}$`) }),
    'cockpit h1 must match the clicked company — guards against wrong-account renders',
  ).toBeVisible({ timeout: 10_000 });

  // 5b. KPI grid: at least one tile visible — proves cockpit metrics rendered.
  const kpiGrid = page.getByRole('region', { name: /account metrics/i });
  await expect(kpiGrid, 'account metrics region must mount').toBeVisible();
  expect(
    await kpiGrid.locator('.kpi').count(),
    'cockpit must show ≥1 KPI tile — empty KPIs means data wiring broke',
  ).toBeGreaterThanOrEqual(1);

  // 6. Technical Stack Overview: ≥1 stack pill (with logo OR text label).
  const stackSection = page.getByRole('region', { name: /technical stack overview/i });
  await expect(stackSection, 'technical stack region must mount').toBeVisible();
  const pills = stackSection.locator('.tech-pill');
  expect(
    await pills.count(),
    'stack overview must render ≥1 pill — empty stack proves enrichment data missing',
  ).toBeGreaterThanOrEqual(1);
  // Pill must carry meaningful content (text or an inline tech logo) — not an empty span.
  const firstPillText = (await pills.first().innerText()).trim();
  const firstPillHasImg = (await pills.first().locator('img, svg').count()) > 0;
  expect(
    firstPillText.length > 0 || firstPillHasImg,
    'first stack pill must contain a label or a logo — empty pills are a render bug',
  ).toBe(true);

  // 7. Business Snapshot: all six dt labels must render in order. We assert
  //    each label individually so a missing field gives a precise failure.
  const snapshot = page.getByRole('region', { name: /business snapshot/i });
  await expect(snapshot, 'business snapshot card must mount').toBeVisible();
  for (const label of [
    'Founded',
    'Headquarters',
    'Annual revenue',
    'Employees',
    'Customer since',
    'Account manager',
  ]) {
    await expect(
      snapshot.locator('dt', { hasText: new RegExp(`^${label}$`) }),
      `business snapshot must include "${label}" — schema contract for the cockpit`,
    ).toBeVisible();
  }

  // 8. Open Issues: all four severity buckets visible. We match the Badge
  //    text (Critical/High/Medium/Low) — counts may legitimately be 0, but
  //    the bucket label must always render so the visual is comparable
  //    across customers (see comment in OpenIssuesCard).
  const issues = page.getByRole('region', { name: /open issues by severity/i });
  await expect(issues, 'open issues card must mount').toBeVisible();
  for (const bucket of ['Critical', 'High', 'Medium', 'Low']) {
    await expect(
      issues.getByText(new RegExp(`^${bucket}$`)),
      `open issues must always show the "${bucket}" bucket — even at zero`,
    ).toBeVisible();
  }

  // 9. Navigate back via the sidebar Accounts link (not browser back) — this
  //    proves the primary nav is reachable from a deep route.
  const sidebar = page.getByRole('navigation', { name: /primary navigation/i });
  await sidebar.getByRole('link', { name: /^Accounts$/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  // 10. Breadcrumb confirms current page. The Topbar derives crumbs from the
  //     URL slug (see Topbar.deriveCrumbs); /accounts has no entry in
  //     ROUTE_LABELS so it renders the lowercase slug "accounts". We match
  //     case-insensitively and assert the aria-current contract is intact —
  //     that's the load-bearing accessibility property the mission requires.
  const breadcrumb = page.getByRole('navigation', { name: /breadcrumb/i });
  await expect(breadcrumb, 'topbar breadcrumb must render').toBeVisible();
  const current = breadcrumb.locator('[aria-current="page"]');
  await expect(current, 'breadcrumb must mark the current page with aria-current').toBeVisible();
  await expect(current, 'current crumb must read "Accounts" (case-insensitive)').toHaveText(
    /^accounts$/i,
  );
});

function escapeRegex(s: string): string {
  return s.replace(/[/\\^$+?.()|[\]{}]/g, '\\$&');
}
