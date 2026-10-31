// Meeting intel against the real API (local seed: /workspace/redo/seed-meetings.py).
// Skips cleanly when the API has no meeting-intel routes or no meetings.
import { test, expect } from './fixtures.js';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';
const CI = 'c0000000-0000-4000-8000-000000000001';

test.describe('meeting intel', () => {
  test.beforeEach(async ({ request }) => {
    const r = await request.get(`${API_URL}/api/v1/meeting-intel?limit=1`);
    test.skip(!r.ok(), `meeting-intel API unavailable (${r.status()})`);
    const body = (await r.json()) as { items: unknown[] };
    test.skip(body.items.length === 0, 'no meetings seeded');
  });

  test('list opens a meeting with what we learned and who was there', async ({ page }) => {
    await page.goto('/meetings');
    await expect(page.getByRole('heading', { level: 1, name: 'Meetings' })).toBeVisible();
    const link = page.locator('table tbody tr a').first();
    const title = (await link.textContent())?.trim() ?? '';
    await link.click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What we learned' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Who was there' })).toBeVisible();
  });

  test('account card shows coverage and drills into people', async ({ page }) => {
    await page.goto(`/accounts/${CI}`);
    const card = page.getByTestId('account-who-we-met');
    await expect(card).toBeVisible({ timeout: 15_000 });
    const cell = card.locator('button[aria-pressed]:not([data-gap])').filter({ hasNotText: '–' }).first();
    await cell.click();
    await expect(cell).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByTestId('people-drill').locator('li').first()).toBeVisible({ timeout: 10_000 });
  });

  test('flags deep link and settings sources', async ({ page, request }) => {
    const r = await request.get(`${API_URL}/api/v1/meeting-intel/flags?status=all`);
    const flags = r.ok() ? ((await r.json()) as { items: { id: string }[] }).items : [];
    if (flags.length) {
      const last = flags[flags.length - 1]!;
      await page.goto(`/meeting-intel/flags/${last.id}`);
      await expect(page.getByTestId('meeting-flag').first()).toHaveAttribute('id', `flag-${last.id}`);
    }
    await page.goto('/settings?tab=meeting-sources');
    await expect(page.getByTestId('metis-source')).toBeVisible();
    await expect(page.getByTestId('abc-source')).toBeVisible();
  });
});
