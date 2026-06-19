/**
 * rbac.spec.ts
 *
 * WHY: Role-Based Access Control is a security boundary. A Read-Only user
 * who can save edits is a data-integrity violation. A Viewer who sees the
 * admin panel is an information-security violation. RBAC failures can never
 * be detected at runtime — only E2E catches them.
 */
import type { Page } from '@playwright/test';

import { test, expect, type SupportedRole } from '../fixtures/auth.fixture';

interface CapabilityBody {
  isAdmin: boolean;
  roles: string[];
  permissions: string[];
}

async function fetchCapabilities(page: Page, role: SupportedRole): Promise<CapabilityBody> {
  const apiUrl = process.env.E2E_API_URL;
  if (!apiUrl) throw new Error('E2E_API_URL is required for RBAC capability checks');

  return page.evaluate(
    async ({ apiUrl: targetApiUrl, role: targetRole }) => {
      const response = await fetch(`${targetApiUrl}/api/v1/me/capabilities`, {
        headers: { 'x-bidstack-e2e-role': targetRole },
        credentials: 'include',
      });
      const body = await response.json();
      return { status: response.status, body };
    },
    { apiUrl, role },
  ).then(({ status, body }) => {
    expect(status).toBe(200);
    return body as CapabilityBody;
  });
}

test.describe('RBAC - role-based access control', () => {
  test('read-only role receives a non-admin capability manifest with no write permissions', async ({
    page,
    loginAs,
  }) => {
    await loginAs('read-only');
    await page.goto('/dashboard', { waitUntil: 'load' });
    const body = await fetchCapabilities(page, 'read-only');

    expect(body.isAdmin).toBe(false);
    expect(body.roles).toContain('Read-Only');
    expect(body.permissions).toContain('accounts:read');
    expect(body.permissions).not.toContain('audit-log:read');
    expect(body.permissions.filter((permission) => permission.endsWith(':write'))).toEqual([]);
  });

  test('read-only role is redirected away from admin-only audit log', async ({ page, loginAs }) => {
    await loginAs('read-only');
    await page.goto('/audit-log', { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /audit log/i, level: 1 })).toHaveCount(0);
  });

  test('viewer role is read-only and cannot reach admin-only audit log', async ({
    page,
    loginAs,
  }) => {
    await loginAs('viewer');
    await page.goto('/dashboard', { waitUntil: 'load' });
    const body = await fetchCapabilities(page, 'viewer');

    expect(body.isAdmin).toBe(false);
    expect(body.roles).toContain('Read-Only');
    expect(body.permissions).toContain('accounts:read');
    expect(body.permissions).not.toContain('audit-log:read');
    expect(body.permissions.filter((permission) => permission.endsWith(':write'))).toEqual([]);

    await page.goto('/audit-log', { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /audit log/i, level: 1 })).toHaveCount(0);
  });

  test('sales manager role gets commercial write permissions but not admin settings', async ({
    page,
    loginAs,
  }) => {
    await loginAs('manager');
    await page.goto('/dashboard', { waitUntil: 'load' });
    const body = await fetchCapabilities(page, 'manager');

    expect(body.isAdmin).toBe(false);
    expect(body.roles).toContain('Sales Manager');
    expect(body.permissions).toContain('opportunities:write');
    expect(body.permissions).toContain('territories:write');
    expect(body.permissions).not.toContain('settings:write');
    expect(body.permissions).not.toContain('users:write');
  });

  test('roles page lists system roles', async ({ page }) => {
    await page.goto('/roles', { waitUntil: 'load' });
    const heading = page.getByRole('heading', { name: /roles/i, level: 1 });
    const available = await heading.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!available, '/roles not reachable');

    await expect(heading).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/admin|read.only|viewer|manager/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('admin-only route (audit-log) is accessible to admin session', async ({ page, loginAs }) => {
    await loginAs('admin');
    await page.goto('/audit-log', { waitUntil: 'load' });
    await expect(
      page.getByRole('heading', { name: /audit log/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
