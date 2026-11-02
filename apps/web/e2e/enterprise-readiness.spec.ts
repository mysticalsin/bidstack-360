import { expect, test } from './fixtures.js';

test.describe('Enterprise readiness surfaces', () => {
  test('demo banner and identity, team, audit log, and import screens are reachable', async ({
    page,
    gotoAndWait,
  }) => {
    await gotoAndWait('/dashboard');
    await expect(page.getByRole('status').filter({ hasText: /DEMO MODE/i })).toBeVisible({
      timeout: 10_000,
    });

    await gotoAndWait('/settings?tab=identity');
    await expect(page.getByRole('heading', { name: /Login identity/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Dev stub|Jane Smith|Signed in as/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();

    await gotoAndWait('/settings?tab=audit-log');
    await expect(page.getByRole('heading', { name: /Audit log/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await gotoAndWait('/settings?tab=data-import');
    await expect(page.getByText(/Choose a CSV/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByLabel(/What are you importing/i)).toBeVisible();
  });

  test('captures identity, team, audit log, and import screenshots', async ({
    page,
    gotoAndWait,
  }) => {
    const out = process.env.E2E_SCREENSHOT_DIR ?? '/opt/cursor/artifacts';

    await gotoAndWait('/dashboard');
    await expect(page.getByRole('status').filter({ hasText: /DEMO MODE/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({ path: `${out}/demo_mode_banner.png`, fullPage: true });

    await gotoAndWait('/settings?tab=identity');
    await expect(page.getByRole('heading', { name: /Login identity/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({ path: `${out}/login_identity.png`, fullPage: true });

    await page.getByRole('heading', { name: 'Team' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/user_role_admin.png`, fullPage: true });

    await gotoAndWait('/settings?tab=audit-log');
    await expect(page.getByRole('heading', { name: /Audit log/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({ path: `${out}/audit_log.png`, fullPage: true });

    await gotoAndWait('/settings?tab=data-import');
    await expect(page.getByText(/Choose a CSV/i)).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({ path: `${out}/import_flow.png`, fullPage: true });
  });
});
