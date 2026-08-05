// Bid/No-Bid density retarget — the two acceptance lines ROUND2-ULTRAPLAN
// attaches to every Phase-2 surface commit:
//   1. "paste-a-URL reproduces the exact view" (filters + sort), and the writer
//      MERGES rather than replaces, so a foreign param survives a filter click
//      (docs/design-system/url-param-audit.md §2 lists this page's old
//      object-form writes as destructive);
//   2. "no blank table after first paint" — the body is never empty across a
//      view change.
//
// The matrix renders from the criteria registry in @bidstack/shared, so these
// assertions need no seeded data and no opportunity: the ten rows and their
// weights are the same on every machine.
import { test, expect } from './fixtures.js';

const ROW = '[data-testid="criterion-row"]';

const TOTAL_CRITERIA = 10;
const TECHNICAL_CRITERIA = 3;
const COMMERCIAL_CRITERIA = 2;

test.describe('Bid/No-Bid decision matrix — URL as state', () => {
  test('a pasted URL reproduces the exact filtered, sorted view', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/bid-matrix?category=technical&sort=weight&dir=asc');

    const rows = page.locator(ROW);
    await expect(rows).toHaveCount(TECHNICAL_CRITERIA);

    // Ascending weight inside the technical category: 8, 10, 12.
    await expect(rows.nth(0)).toContainText('Solution Readiness');
    await expect(rows.nth(1)).toContainText('Resources Available');
    await expect(rows.nth(2)).toContainText('Technical Capability');

    // The segment named by ?category= is the pressed one.
    await expect(
      page.getByRole('button', { name: /^Technical Readiness, category score/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    // A criterion from another category is genuinely gone, not merely scrolled.
    await expect(rows.filter({ hasText: 'Deal Size' })).toHaveCount(0);
  });

  test('filtering writes the URL and leaves foreign params alone', async ({
    page,
    gotoAndWait,
  }) => {
    // opportunityId is owned by the page's other writer. Before the nuqs
    // conversion, a filter click would have wiped it.
    await gotoAndWait('/bid-matrix?opportunityId=e2e-merge-law');

    await page.getByRole('button', { name: /^Commercial Viability, category score/ }).click();

    await expect(page).toHaveURL(/category=commercial/);
    await expect(page).toHaveURL(/opportunityId=e2e-merge-law/);
    await expect(page.locator(ROW)).toHaveCount(COMMERCIAL_CRITERIA);
  });

  test('sorting writes the URL and survives a reload', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/bid-matrix');

    await page.getByRole('button', { name: 'Sort by Weight.' }).click();
    await expect(page).toHaveURL(/sort=weight/);

    await page.reload({ waitUntil: 'load' });
    await page.getByRole('main').waitFor({ state: 'visible' });

    const rows = page.locator(ROW);
    await expect(rows).toHaveCount(TOTAL_CRITERIA);
    // Default direction is descending, so the heaviest criterion (14) leads.
    await expect(rows.first()).toContainText('Strategic Fit');
    await expect(page.getByRole('button', { name: /^Weight, sorted descending/ })).toBeVisible();
  });
});

test.describe('Bid/No-Bid decision matrix — density', () => {
  test('the criteria table never blanks across a view change', async ({ page, gotoAndWait }) => {
    await gotoAndWait('/bid-matrix');

    const rows = page.locator(ROW);
    await expect(rows).toHaveCount(TOTAL_CRITERIA);

    const segments = [
      /^Strategic Alignment, category score/,
      /^Risk Assessment, category score/,
      /^All criteria, composite score/,
    ];
    for (const name of segments) {
      await page.getByRole('button', { name }).click();
      // Deliberately un-retried: a single immediate count, so an empty frame
      // between views would fail rather than be waited out.
      expect(await rows.count()).toBeGreaterThan(0);
    }

    await expect(rows).toHaveCount(TOTAL_CRITERIA);
  });

  test('rating a criterion fills its rating and weighted-points cells', async ({
    page,
    gotoAndWait,
  }) => {
    await gotoAndWait('/bid-matrix?category=risk');

    const row = page.locator(ROW).filter({ hasText: 'Timeline Risk' });
    await expect(row).toHaveCount(1);
    // Em-dashes before anything is rated — never a blank cell.
    await expect(row).toContainText('—');

    await row.getByRole('button', { name: 'Timeline Risk: Strong' }).click();

    await expect(row).toContainText('Strong');
    // Timeline Risk carries weight 6, so a 4/5 rating contributes 4.8 points.
    await expect(row).toContainText('4.8');
  });
});
