/**
 * Physical journeys against a running Polo stack.
 *
 * Prerequisites: Postgres with pgvector, Redis, API on :4000, worker, and
 * Vite on :5173 with VITE_AUTH_MODE=stub and VITE_ENABLE_E2E_ROLE_HEADER=true.
 * Seed is synthetic (example.com only). No external API keys.
 *
 * Each step saves a screenshot plus console, network, and server logs under
 * SWEEP_EVIDENCE_DIR (default docs/sweeps/sweep-01-evidence).
 *
 * Known defects already owned by open PRs are recorded in the step notes and
 * do not fail this gate. See docs/sweeps/sweep-01-e2e.md.
 */
import type { Page } from '@playwright/test';

import { Evidence } from './evidence.js';
import { expect, test } from './playwright.js';

test.describe('sweep journeys', () => {
  test('drives the product end to end', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const ev = new Evidence(page, testInfo);
    ev.attach();
    const stamp = `${testInfo.project.name}-${Date.now().toString(36)}`;
    const mobile = testInfo.project.name === 'mobile';

    await ev.run('01-sign-in', [], async () => {
      await page.goto('/login');
      await page.evaluate(() => {
        localStorage.setItem('bidstack:stub-signed-out', 'true');
        localStorage.removeItem('bidstack:session');
        localStorage.removeItem('bidstack:stub-role');
      });
      await page.reload();
      const enter = page.getByRole('button', { name: 'Enter workspace' });
      await expect(enter).toBeVisible();
      await enter.click();
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole('main')).toBeVisible();
      await dismissTour(page);
    });

    await ev.run('02-dashboard-add-widget', [], async () => {
      const name = `Sweep board ${stamp}`;
      await page.goto('/dashboards');
      await dismissTour(page);
      await page.getByRole('button', { name: 'New dashboard' }).first().click();
      await page.getByPlaceholder('Dashboard name…').fill(name);
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.getByText(name)).toBeVisible();
      await page.goto('/analytics');
      await expect(page.getByRole('button', { name: 'Add widget' }).first()).toBeVisible();
      const addWidget = page.getByRole('button', { name: 'Add widget' }).first();
      await expect(addWidget).toBeVisible();
      const addBox = await addWidget.boundingBox();
      const view = page.viewportSize();
      if (addBox && view && (addBox.x + addBox.width > view.width + 4 || addBox.y + addBox.height > view.height + 4)) {
        testInfo.annotations.push({
          type: 'known',
          description: `#355 Add widget is outside the ${view.width}px viewport (x=${Math.round(addBox.x)} y=${Math.round(addBox.y)})`,
        });
      }
      await addWidget.evaluate((el) => (el as HTMLButtonElement).click());
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Save widget' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(/Bar Chart|No data available/i).first()).toBeVisible();
    });

    await ev.run('03-accounts-filter-company', [], async () => {
      await page.goto('/accounts');
      await dismissTour(page);
      const search = page.getByRole('searchbox').first();
      await search.fill('Northwind');
      const link = page.getByRole('link', { name: /Northwind Labs/ }).first();
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(/\/accounts\/11111111-1111-4111-8111-111111111111/);
      await expect(page.getByRole('heading', { name: 'Northwind Labs' })).toBeVisible();
    });

    await ev.run('04-revenue-margin-open-jobs', [], async () => {
      await page.goto('/accounts/11111111-1111-4111-8111-111111111111');
      await dismissTour(page);
      const revenue = page.getByTestId('kn-revenue');
      const margin = page.getByTestId('kn-margin');
      const jobs = page.getByTestId('kn-open_jobs');
      await expect(revenue).toBeVisible();
      await expect(margin).toBeVisible();
      await expect(jobs).toBeVisible();
      await expect(revenue).toContainText('480');
      await expect(margin).toContainText('15');
      await expect(jobs).toContainText('3');
      await expect(revenue).not.toContainText(/Not found yet/i);
      await expect(margin).not.toContainText(/Sample/i);
    });

    await ev.run('05-pipeline-drag', [], async () => {
      await page.goto('/pipeline');
      await dismissTour(page);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { name: 'Pipeline', level: 1 })).toBeVisible();
      const sent = main.getByRole('region', { name: /S2 Sent column/i });
      await expect(sent).toBeVisible();
      if (!mobile) {
        const negotiation = main.getByRole('region', { name: /S4 Negotiation column/i });
        const board = await main.boundingBox();
        const column = await negotiation.boundingBox();
        if (board && column && column.x + 40 > board.x + board.width) {
          // Owned by #361. Recorded in the sweep log; the drag below still runs.
          testInfo.annotations.push({
            type: 'known',
            description: `#361 pipeline column sliced at 1280 (S4 x=${Math.round(column.x)} boardRight=${Math.round(board.x + board.width)})`,
          });
        }
      }
      const card = main.getByTestId('pipeline-card').filter({ hasText: 'Yard systems' });
      await expect(card).toBeVisible();
      await card.dragTo(sent, { targetPosition: { x: 30, y: 80 } });
      await expect(sent.getByTestId('pipeline-card').filter({ hasText: 'Yard systems' })).toBeVisible();
    });

    await ev.run('06-opportunity-create-edit-close', [], async () => {
      const name = `Northwind Labs — Sweep ${stamp}`;
      await page.goto('/opportunities');
      await dismissTour(page);
      await page.getByRole('button', { name: '+ New opportunity' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Customer').fill('Northwind');
      await page.getByRole('option', { name: /Northwind Labs/ }).first().click();
      await dialog.getByLabel('Opportunity name').fill(name);
      await dialog.getByLabel('Value (EUR)').fill('125000');
      await dialog.getByRole('button', { name: 'Create opportunity' }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole('link', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
      await expect(page).toHaveURL(/\/opportunities\//);
      await page.getByRole('button', { name: 'Edit opportunity name' }).click();
      const editor = page.getByRole('textbox').first();
      await editor.fill(`${name} revised`);
      await editor.press('Enter');
      await expect(page.getByText(`${name} revised`).first()).toBeVisible();
      if (mobile) {
        await page.getByRole('button', { name: 'Mark Lost' }).click();
        await expect(page.getByRole('button', { name: 'Lost' })).toBeVisible();
      } else {
        await page.getByRole('button', { name: 'Mark Won' }).click();
        await expect(page.getByRole('button', { name: 'Won' })).toBeVisible();
      }
    });

    await ev.run('07-tasks', [], async () => {
      const title = `Sweep task ${stamp}`;
      await page.goto('/tasks');
      await dismissTour(page);
      await page.getByRole('button', { name: '+ New task' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Title').fill(title);
      await dialog.locator('#task-due').fill('2026-11-21');
      await dialog.getByRole('button', { name: 'Create task' }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole('group', { name: 'Filter tasks' }).getByRole('button', { name: 'Today' }).click();
      await expect(page).toHaveURL(/filter=today/);
      const row = page.getByRole('listitem').filter({ hasText: title });
      await expect(row).toBeVisible();
      await expect(row).toContainText(/Nov 21, 2026/);
      await row.getByRole('button', { name: /Status:/ }).click();
      await expect(row).toContainText(/in progress/i);
      await row.getByRole('button', { name: /Status:/ }).click();
      await page.getByRole('group', { name: 'Filter tasks' }).getByRole('button', { name: 'Done' }).click();
      await expect(page.getByRole('listitem').filter({ hasText: title })).toContainText('done');

      await page.getByRole('group', { name: 'Filter tasks' }).getByRole('button', { name: 'All' }).click();
      const pageCount = await page.getByRole('listitem').count();
      const badge = page.locator('a[href="/tasks"] .sb-badge').first();
      const badgeCount = (await badge.count()) ? Number((await badge.innerText()).trim()) : 0;
      if (badgeCount !== pageCount) {
        testInfo.annotations.push({
          type: 'known',
          description: `#375 Tasks badge ${badgeCount} vs page rows ${pageCount}`,
        });
      }
    });

    await ev.run('08-csv-import', [], async () => {
      const company = `Pinnacle Grid ${stamp}`;
      await page.goto('/settings?tab=data-import');
      await dismissTour(page);
      await page.locator('input[type="file"]').setInputFiles({
        name: 'synthetic.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(`name,domain\n${company},pinnacle-${stamp}.example\n`),
      });
      await expect(page.getByRole('columnheader', { name: 'Maps to' })).toBeVisible();
      if (mobile) {
        const overflow = await page.evaluate(() => {
          const table = document.querySelector('table');
          if (!table) return 0;
          return table.getBoundingClientRect().right - window.innerWidth;
        });
        expect(overflow).toBeLessThanOrEqual(8);
      }
      await page.getByRole('button', { name: /Preview/ }).click();
      await expect(page.getByText(/looks valid|passed validation/i).first()).toBeVisible();
      await page.getByRole('button', { name: 'Confirm import' }).click();
      await expect(page.getByText('Import complete')).toBeVisible({ timeout: 30_000 });
    });

    await ev.run('09-proposal', [], async () => {
      const name = `Sweep proposal ${stamp}`;
      await page.goto('/proposals');
      await dismissTour(page);
      await expect(page.getByText('Northwind Labs — Data platform proposal').first()).toBeVisible();
      await page.getByRole('button', { name: 'New Proposal' }).click();
      const sheet = page.getByRole('dialog');
      await sheet.getByLabel('Proposal name').fill(name);
      await sheet.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.getByText(name).first()).toBeVisible();
      const proposalLink = page.getByRole('link', { name }).first();
      await expect(proposalLink).toBeVisible();
      if (mobile) {
        const covered = await proposalLink.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + 4, rect.y + rect.height / 2);
          return hit ? !el.contains(hit) : true;
        });
        if (covered) {
          testInfo.annotations.push({
            type: 'finding',
            description: 'proposals table cell covers the proposal name link at mobile width',
          });
        }
      }
      await proposalLink.click({ force: mobile });
      await expect(page).toHaveURL(/\/proposals\//);
      await expect(page.getByText('Executive Summary')).toBeVisible();
    });

    await ev.run('10-settings-demo-and-roles', [], async () => {
      await page.evaluate(() => localStorage.removeItem('bidstack:stub-role'));
      await page.goto('/settings?tab=identity');
      await dismissTour(page);
      await expect(page.getByText('Data mode').first()).toBeVisible();
      await expect(page.getByText('Demo', { exact: true }).first()).toBeVisible();
      const toggle = page.getByRole('switch', { name: /demo/i });
      if ((await toggle.count()) === 0) {
        testInfo.annotations.push({
          type: 'known',
          description: '#364 settings show Data mode Demo and no admin demo-data toggle',
        });
      }
      const settingsMenu = page.getByRole('button', { name: 'Settings menu' });
      if (await settingsMenu.isVisible().catch(() => false)) await settingsMenu.click();
      await expect(page.getByRole('link', { name: 'Data import' }).or(page.getByRole('button', { name: 'Data import' })).first()).toBeVisible();

      await page.evaluate(() => localStorage.setItem('bidstack:stub-role', 'account-executive'));
      await page.goto('/settings?tab=data-import');
      await expect(page.getByText('Data import').first()).toBeHidden({ timeout: 10_000 }).catch(async () => {
        await expect(page.getByText(/admin only|limited to administr/i).first()).toBeVisible();
      });
      await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);
      await page.evaluate(() => localStorage.removeItem('bidstack:stub-role'));
    });

    await ev.run('11-integrations-not-connected', [], async () => {
      await page.goto('/settings?tab=integrations');
      await dismissTour(page);
      const main = page.getByRole('main');
      await expect(main.getByText('Not connected').first()).toBeVisible();
      await expect(main.getByText(/^Connected$/)).toHaveCount(0);
    });

    await ev.run('12-logout', [], async () => {
      await page.goto('/dashboard');
      await dismissTour(page);
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole('button', { name: 'Enter workspace' })).toBeVisible();
      await page.goto('/accounts');
      await expect(page).toHaveURL(/\/login/);
    });

    await ev.flush();
  });
});

async function dismissTour(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: /Skip tour/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}
