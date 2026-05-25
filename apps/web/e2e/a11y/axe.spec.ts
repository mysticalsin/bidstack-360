/**
 * axe.spec.ts — axe-core accessibility audit for all key routes.
 *
 * WHY: WCAG 2.2 AA is a hard requirement per the Toto360 spec and Tony's
 * design standards. Axe catches ~57% of WCAG failures automatically.
 * Running it per-route ensures regressions are caught at the screen level,
 * not buried in a component test.
 *
 * IMPACT LEVEL: we gate on "critical" and "serious" violations only.
 * "Moderate" and "minor" are logged but don't fail the build — they populate
 * baseline.json for tracking.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** All routes covered by this suite. */
const ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'opportunities-list', path: '/opportunities' },
  { name: 'pipeline', path: '/pipeline' },
  { name: 'leads-list', path: '/leads' },
  { name: 'contacts-list', path: '/contacts' },
  { name: 'companies-list', path: '/accounts' },
  { name: 'reports', path: '/reports' },
  { name: 'integrations', path: '/integrations' },
  { name: 'settings', path: '/settings' },
  { name: 'audit-log', path: '/audit-log' },
  { name: 'tasks', path: '/tasks' },
  { name: 'invoices', path: '/invoices' },
  { name: 'service-desk', path: '/service-desk' },
  { name: 'sales-dashboard', path: '/sales' },
  { name: 'roles', path: '/roles' },
  { name: 'quick-start', path: '/quick-start' },
  { name: 'search', path: '/search' },
  { name: 'intake', path: '/intake' },
  { name: 'new-lead', path: '/leads/new' },
] as const;

/** Impact levels that fail the build — critical and serious are spec-mandated. */
const BLOCKING_IMPACTS = ['critical', 'serious'] as const;

for (const route of ROUTES) {
  test(`${route.name}: 0 critical/serious axe violations`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'load' });
    // Wait for main landmark so lazy content is resolved before scan.
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
      // Some routes (audit-log) redirect non-admins — still scan what's there.
    });

    // Give lazy chunks a moment to render
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'])
      // Exclude third-party iframes (Clerk, DocuSign widgets) from scan scope.
      .exclude('iframe')
      .analyze();

    const blockingViolations = results.violations.filter(
      (v) => BLOCKING_IMPACTS.includes(v.impact as (typeof BLOCKING_IMPACTS)[number]),
    );

    if (blockingViolations.length > 0) {
      const summary = blockingViolations.map((v) =>
        `  [${v.impact?.toUpperCase()}] ${v.id}: ${v.description}\n` +
        v.nodes.slice(0, 2).map((n) => `    target: ${JSON.stringify(n.target)}`).join('\n'),
      ).join('\n');
      throw new Error(
        `${blockingViolations.length} critical/serious axe violation(s) on ${route.path}:\n${summary}`,
      );
    }

    // Log non-blocking violations for baseline tracking (don't throw)
    const nonBlocking = results.violations.filter(
      (v) => !BLOCKING_IMPACTS.includes(v.impact as (typeof BLOCKING_IMPACTS)[number]),
    );
    if (nonBlocking.length > 0) {
      // Using test.info() to attach to HTML report for review
      test.info().annotations.push({
        type: 'non-blocking axe violations',
        description: nonBlocking.map((v) => `${v.id} (${v.impact})`).join(', '),
      });
    }

    expect(blockingViolations.length).toBe(0);
  });
}
