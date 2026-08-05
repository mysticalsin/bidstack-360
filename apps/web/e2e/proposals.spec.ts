import type { Page } from '@playwright/test';

import { test, expect } from './fixtures.js';

/**
 * Proposals — the density retarget's acceptance criteria, asserted.
 * (ROUND2-ULTRAPLAN Phase 2, commit 2: "each surface carries its e2e updates".)
 *
 * Three things this file exists to prove, because each of them is a regression
 * that a screenshot would not catch:
 *   1. pasting the URL reproduces the exact view — stage tab, search, sort
 *      direction and page all round-trip, and Back walks pages;
 *   2. the table body is NEVER empty during a page transition (risk #7: "the
 *      port must not feel worse than the RSC source on first paint");
 *   3. the density law holds on a real row — statuses are dot+word indicators,
 *      not coloured pills, and no visible cell is blank (nulls are em-dashes).
 *
 * Rows are seeded through the API and deleted in `finally`, so the spec is
 * independent of whatever the shared seed left behind: every assertion is
 * scoped to a per-run stamp that is also used as the `?q=` search term.
 */

type SeededProposal = { id: string; name: string };

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

/** A body row, as opposed to the single full-width empty/skeleton row. */
const DATA_ROWS = '[data-slot="table-body"] tr:not(:has(td[colspan]))';

async function seedProposals(page: Page, stamp: string): Promise<SeededProposal[]> {
  const created: SeededProposal[] = [];
  for (const [index, label] of NAMES.entries()) {
    const res = await page.request.post('/api/v1/proposals', {
      // Every other row is left without a deadline on purpose — the em-dash
      // assertion below needs a genuinely null cell to look at.
      data: {
        name: `${stamp} ${label}`,
        ...(index % 2 === 0 ? { dueDate: `2026-12-0${index + 1}` } : {}),
      },
      timeout: 15_000,
    });
    expect(res.ok(), await res.text()).toBe(true);
    const body = (await res.json()) as { id: string; name: string };
    created.push({ id: body.id, name: body.name });
  }
  return created;
}

async function cleanup(page: Page, created: SeededProposal[]): Promise<void> {
  for (const proposal of created) {
    await page.request.delete(`/api/v1/proposals/${proposal.id}`, { timeout: 15_000 });
  }
}

/** First column of the first body row — the proposal-name link. */
function firstRowName(page: Page) {
  return page.locator(DATA_ROWS).first().locator('td').first();
}

test('proposals view round-trips search, sort and page through the URL', async ({
  page,
  gotoAndWait,
}) => {
  const stamp = `E2ERT${Date.now()}`;
  const created = await seedProposals(page, stamp);

  try {
    // Five per page over six rows: two pages, no need to seed 26 rows.
    const listUrl = `/proposals?q=${stamp}&sort=name&dir=asc&pageSize=5`;
    await gotoAndWait(listUrl);
    await expect(page.locator('h1')).toContainText('Proposals', { timeout: 15_000 });

    await expect(page.locator(DATA_ROWS)).toHaveCount(5, { timeout: 20_000 });
    await expect(firstRowName(page)).toHaveText(`${stamp} Alpha`);
    await expect(page.getByText('1 / 2')).toBeVisible();

    // (1) Same URL, fresh load → identical view. This is the whole point of
    // putting the view in the query string rather than in component state.
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator(DATA_ROWS)).toHaveCount(5, { timeout: 20_000 });
    await expect(firstRowName(page)).toHaveText(`${stamp} Alpha`);

    // (2) Sort direction is read from the URL, not from a click.
    await page.goto(`/proposals?q=${stamp}&sort=name&dir=desc&pageSize=5`, { waitUntil: 'load' });
    await expect(firstRowName(page)).toHaveText(`${stamp} Foxtrot`, { timeout: 20_000 });

    // (3) Pagination pushes history, so Back walks pages (url-param-audit §6).
    await page.goto(listUrl, { waitUntil: 'load' });
    await expect(firstRowName(page)).toHaveText(`${stamp} Alpha`, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/[?&]page=2\b/, { timeout: 10_000 });
    await expect(page.locator(DATA_ROWS)).toHaveCount(1);
    await expect(firstRowName(page)).toHaveText(`${stamp} Foxtrot`);

    await page.goBack();
    await expect(page).not.toHaveURL(/[?&]page=2\b/, { timeout: 10_000 });
    await expect(page.locator(DATA_ROWS)).toHaveCount(5);
    await expect(firstRowName(page)).toHaveText(`${stamp} Alpha`);

    // The other params survived the page walk — a writer that replaced the
    // query string instead of merging it would have dropped them.
    await expect(page).toHaveURL(new RegExp(`q=${stamp}`));
    await expect(page).toHaveURL(/dir=asc/);
  } finally {
    await cleanup(page, created);
  }
});

test('the proposals table body never goes empty during a page transition', async ({
  page,
  gotoAndWait,
}) => {
  const stamp = `E2EBLANK${Date.now()}`;
  const created = await seedProposals(page, stamp);

  try {
    await gotoAndWait(`/proposals?q=${stamp}&sort=name&dir=asc&pageSize=5`);
    await expect(page.locator(DATA_ROWS)).toHaveCount(5, { timeout: 20_000 });

    // Watch the tbody on every mutation AND on a 16ms tick, so a blank frame
    // that no later mutation follows is still caught.
    await page.evaluate(() => {
      const scope = window as unknown as { __blankFrames?: number; __blankTimer?: number };
      scope.__blankFrames = 0;
      const body = document.querySelector('[data-slot="table-body"]');
      if (!body) throw new Error('table body not found');
      const sample = () => {
        // Array.from, not spread: the e2e tsconfig targets a lib without
        // NodeList iteration.
        const dataRows = Array.from(body.querySelectorAll('tr')).filter(
          (row) => !row.querySelector('td[colspan]'),
        );
        if (dataRows.length === 0) scope.__blankFrames = (scope.__blankFrames ?? 0) + 1;
      };
      new MutationObserver(sample).observe(body, { childList: true, subtree: true });
      scope.__blankTimer = window.setInterval(sample, 16);
    });

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator(DATA_ROWS)).toHaveCount(1, { timeout: 10_000 });
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(page.locator(DATA_ROWS)).toHaveCount(5, { timeout: 10_000 });

    const blankFrames = await page.evaluate(() => {
      const scope = window as unknown as { __blankFrames?: number; __blankTimer?: number };
      if (scope.__blankTimer) window.clearInterval(scope.__blankTimer);
      return scope.__blankFrames ?? -1;
    });
    expect(blankFrames).toBe(0);
  } finally {
    await cleanup(page, created);
  }
});

test('proposal rows carry status dots and em-dashes, never pills or blank cells', async ({
  page,
  gotoAndWait,
}) => {
  const stamp = `E2EDENSE${Date.now()}`;
  const created = await seedProposals(page, stamp);

  try {
    await gotoAndWait(`/proposals?q=${stamp}&sort=name&dir=asc&pageSize=5`);
    await expect(page.locator(DATA_ROWS)).toHaveCount(5, { timeout: 20_000 });

    const row = page.locator(DATA_ROWS).first();

    // Stage is a dot + word indicator, not a coloured pill.
    await expect(row.locator('[data-slot="status-indicator"]')).toHaveCount(1);
    await expect(row.locator('[data-slot="indicator-dot"]')).toHaveCount(1);

    // Zero blank cells: a fresh proposal has no compliance score and (for the
    // odd-indexed seeds) no deadline, so those cells must carry the em-dash.
    const cells = await row.locator('td').allTextContents();
    expect(cells.length).toBeGreaterThan(4);
    expect(cells.every((cell) => cell.trim().length > 0)).toBe(true);
    expect(cells.some((cell) => cell.trim() === '—')).toBe(true);

    // The header stays with the rows in one scroller — sticky, per the retarget.
    const headerPosition = await page
      .locator('[data-slot="table-header"]')
      .evaluate((node) => getComputedStyle(node).position);
    expect(headerPosition).toBe('sticky');
  } finally {
    await cleanup(page, created);
  }
});
