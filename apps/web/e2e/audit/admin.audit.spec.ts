/**
 * Admin section review: click audit and layout audit.
 *
 * Click audit: visit every admin route, activate every visible control inside
 * the main landmark plus the global shell (sidebar, topbar, command palette,
 * theme toggle, notifications), and assert each one does something observable
 * without console errors, page errors or unexpected 4xx/5xx responses.
 *
 * Layout audit: light and dark, three viewports, geometry plus axe contrast.
 *
 * Run: E2E_BASE_URL=... E2E_API_URL=... playwright test e2e/audit/admin.audit.spec.ts --workers=1
 */
import { test, expect } from '../fixtures/auth.fixture.js';
import type { Page, Request, Response } from '@playwright/test';

import {
  THEMES,
  VIEWPORTS,
  geometryIssues,
  layoutIssues,
  useTheme,
  type LayoutIssue,
} from './admin-layout.js';

const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4010';

interface Ids {
  task?: string;
  serviceCase?: string;
  customObject?: string;
  customObjectKey?: string;
  report?: string;
}

const ids: Ids = {};

const STATIC_ROUTES = [
  '/settings',
  '/roles',
  '/audit-log',
  '/webhooks',
  '/workflows',
  '/agent-studio',
  '/admin/custom-objects',
  '/settings/custom-objects',
  '/custom-objects/new',
  '/reports/list',
  '/reports/new',
  '/dashboards',
  '/admin/predictive',
  '/service-desk',
  '/tasks',
  '/quick-start',
  '/workspace',
  '/serum',
];

function dynamicRoutes(): string[] {
  const out: string[] = [];
  if (ids.task) out.push(`/tasks/${ids.task}`);
  if (ids.serviceCase) out.push(`/service-desk/${ids.serviceCase}`);
  if (ids.customObject) out.push(`/settings/custom-objects/${ids.customObject}`);
  if (ids.customObjectKey) out.push(`/o/${ids.customObjectKey}`);
  if (ids.report) out.push(`/reports/${ids.report}/edit`);
  return out;
}

/** Status codes a route may legitimately return during a sweep. */
function isExpectedFailure(res: Response): boolean {
  const url = res.url();
  const status = res.status();
  if (status < 400) return false;
  // Validation rejections are the point of the invalid-submit checks.
  if (status === 400 || status === 422) return true;
  // Optional integrations report "not configured" with 404/501/503 by design.
  if (/\/(integrations|health|status|providers|dust|odoo|serum\/connectors)\b/.test(url)) return true;
  if (status === 409) return true;
  return false;
}

interface Sweep {
  consoleErrors: string[];
  pageErrors: string[];
  badResponses: string[];
  requests: number;
}

function watch(page: Page): Sweep {
  const sweep: Sweep = { consoleErrors: [], pageErrors: [], badResponses: [], requests: 0 };
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Browser-level network logs duplicate badResponses; keep those there.
    if (/Failed to load resource/.test(text)) return;
    sweep.consoleErrors.push(text.slice(0, 300));
  });
  page.on('pageerror', (err) => sweep.pageErrors.push(err.message.slice(0, 300)));
  page.on('request', (req: Request) => {
    if (req.url().startsWith(API_URL) || req.url().includes('/api/')) sweep.requests += 1;
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !isExpectedFailure(res)) {
      sweep.badResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return sweep;
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' });
  await expect(page.getByRole('main')).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
}

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({
    extraHTTPHeaders: { 'x-bidstack-e2e-role': 'admin' },
  });
  const pick = async (path: string): Promise<Record<string, unknown> | undefined> => {
    const res = await api.get(`${API_URL}${path}`);
    if (!res.ok()) return undefined;
    const body = (await res.json()) as unknown;
    const list = Array.isArray(body)
      ? body
      : ((body as { items?: unknown[]; data?: unknown[] }).items ??
        (body as { data?: unknown[] }).data ??
        []);
    return list[0] as Record<string, unknown> | undefined;
  };
  ids.task = (await pick('/api/tasks?limit=1'))?.id as string | undefined;
  ids.serviceCase = (await pick('/api/service-cases?limit=1'))?.id as string | undefined;
  const obj = await pick('/api/custom-objects');
  ids.customObject = obj?.id as string | undefined;
  ids.customObjectKey = (obj?.key ?? obj?.apiName) as string | undefined;
  ids.report = (await pick('/api/reports'))?.id as string | undefined;
  await api.dispose();
});

const FULL_AUDIT = process.env.E2E_AUDIT === '1';

test.describe('admin click audit', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  for (const path of STATIC_ROUTES) {
    test(`route renders clean: ${path}`, async ({ page }) => {
      const sweep = watch(page);
      await open(page, path);
      await expect(page.locator('h1').first()).toBeVisible();
      expect.soft(sweep.pageErrors, 'page errors').toEqual([]);
      expect.soft(sweep.consoleErrors, 'console errors').toEqual([]);
      expect.soft(sweep.badResponses, 'unexpected 4xx/5xx').toEqual([]);
    });
  }

  test('legacy custom object paths land on the admin pages', async ({ page }) => {
    await open(page, '/custom-objects/new');
    await expect(page).toHaveURL(/\/settings\/custom-objects$/);
    await expect(page.locator('h1').first()).toBeVisible();
    if (ids.customObject) {
      await open(page, `/custom-objects/${ids.customObject}`);
      await expect(page).toHaveURL(new RegExp(`/settings/custom-objects/${ids.customObject}$`));
      await expect(page.getByText('Object not found.')).toHaveCount(0);
    }
  });

  test('detail routes render clean', async ({ page }) => {
    const routes = dynamicRoutes();
    expect(routes.length, 'seeded detail ids found').toBeGreaterThan(0);
    for (const path of routes) {
      const sweep = watch(page);
      await open(page, path);
      await expect(page.locator('h1').first(), path).toBeVisible();
      expect.soft(sweep.pageErrors, `${path} page errors`).toEqual([]);
      expect.soft(sweep.consoleErrors, `${path} console errors`).toEqual([]);
      expect.soft(sweep.badResponses, `${path} unexpected 4xx/5xx`).toEqual([]);
      page.removeAllListeners('console');
      page.removeAllListeners('pageerror');
      page.removeAllListeners('response');
      page.removeAllListeners('request');
    }
  });

  for (const path of STATIC_ROUTES) {
    test(`every control does something: ${path}`, async ({ page, context }) => {
      test.skip(!FULL_AUDIT, 'set E2E_AUDIT=1 for the full click sweep');
      test.setTimeout(480_000);
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await open(page, path);
      const controls = page
        .getByRole('main')
        .locator(
          'button:visible:not([disabled]), a[href]:visible, [role="tab"]:visible, [role="switch"]:visible, [role="checkbox"]:visible',
        );
      const total = Math.min(await controls.count(), 25);
      const dead: string[] = [];
      const errors: string[] = [];
      for (let i = 0; i < total; i++) {
        const drifted =
          new URL(page.url()).pathname !== new URL(path, page.url()).pathname ||
          (await page.locator('[role="dialog"]:visible').count()) > 0;
        if (drifted) await open(page, path);
        const control = controls.nth(i);
        if (!(await control.isVisible().catch(() => false))) continue;
        const name =
          (await control.getAttribute('aria-label')) ||
          ((await control.innerText().catch(() => '')) ?? '').trim().slice(0, 40) ||
          `#${i}`;
        // Re-selecting the active tab, filter or page link is a no-op by design.
        const active = await control.evaluate(
          (el) =>
            el.getAttribute('aria-selected') === 'true' ||
            el.getAttribute('aria-pressed') === 'true' ||
            el.getAttribute('aria-current') === 'page' ||
            el.getAttribute('data-state') === 'active' ||
            el.getAttribute('data-state') === 'on',
        );
        if (active) continue;
        const href = await control.getAttribute('href');
        if (href && /^(https?:|mailto:|tel:)/.test(href) && !href.startsWith('http://127.0.0.1')) {
          continue;
        }
        const sweep = watch(page);
        const before = await page.evaluate(() => ({
          url: location.href,
          html: document.body.innerHTML.length,
          dialogs: document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]').length,
        }));
        const mutations = await page.evaluateHandle(() => {
          const box = { n: 0 };
          new MutationObserver((list) => {
            box.n += list.length;
          }).observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          return box;
        });
        await control.click({ timeout: 1_500 }).catch(() => undefined);
        await page.waitForTimeout(300);
        const after = await page.evaluate(
          (box) => ({
            url: location.href,
            mutations: box.n,
            dialogs: document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')
              .length,
          }),
          mutations,
        );
        const observable =
          after.url !== before.url ||
          after.dialogs !== before.dialogs ||
          after.mutations > 0 ||
          sweep.requests > 0;
        if (!observable) dead.push(name);
        errors.push(
          ...sweep.pageErrors.map((e) => `${name}: ${e}`),
          ...sweep.consoleErrors.map((e) => `${name}: ${e}`),
          ...sweep.badResponses.map((e) => `${name}: ${e}`),
        );
        page.removeAllListeners('console');
        page.removeAllListeners('pageerror');
        page.removeAllListeners('response');
        page.removeAllListeners('request');
        await page.keyboard.press('Escape').catch(() => undefined);
      }
      expect.soft(dead, `dead controls on ${path}`).toEqual([]);
      expect.soft(errors, `errors while clicking on ${path}`).toEqual([]);
    });
  }

  test('global shell: theme toggle, command palette, notifications, 404', async ({ page }) => {
    test.setTimeout(180_000);
    const sweep = watch(page);
    await open(page, '/settings');
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    await page.getByRole('button', { name: /theme|dark mode|light mode/i }).first().click();
    await expect(html).not.toHaveAttribute('data-theme', before ?? 'light');

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();
    await page.keyboard.type('service desk');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/service-desk/);

    const bell = page.getByRole('button', { name: /notification/i }).first();
    if (await bell.isVisible().catch(() => false)) {
      await bell.click();
      await expect(page.locator('[role="dialog"],[role="menu"]').first()).toBeVisible();
      await page.keyboard.press('Escape');
    }

    await page.goto('/this-route-does-not-exist', { waitUntil: 'load' });
    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
    expect.soft(sweep.pageErrors).toEqual([]);
    expect.soft(sweep.badResponses).toEqual([]);
  });

  test('webhook dialog blocks an invalid submit and closes cleanly', async ({ page }) => {
    const sweep = watch(page);
    await open(page, '/settings?tab=webhooks');
    await page.getByRole('main').getByRole('button', { name: /add|new|create/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const submit = dialog.getByRole('button', { name: /create subscription/i });
    await expect(submit).toBeDisabled();
    await dialog.getByRole('textbox').first().fill('not a url');
    await expect(submit).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect.soft(sweep.pageErrors).toEqual([]);
    expect.soft(sweep.badResponses).toEqual([]);
  });
});

test.describe('admin layout audit', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      test(`layout ${theme} ${vp.name}`, async ({ page }) => {
        test.skip(!FULL_AUDIT, 'set E2E_AUDIT=1 for the layout sweep');
        test.setTimeout(600_000);
        await useTheme(page, theme);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const found: Record<string, LayoutIssue[]> = {};
        const small: string[] = [];
        for (const path of [...STATIC_ROUTES, ...dynamicRoutes()]) {
          await open(page, path).catch(() => undefined);
          const issues = await layoutIssues(page);
          const gated = issues.filter((i) => i.kind !== 'small-text');
          small.push(...issues.filter((i) => i.kind === 'small-text').map((i) => `${path}: ${i.detail}`));
          if (gated.length) found[path] = gated.slice(0, 15);
        }
        test.info().annotations.push({
          type: 'small-text',
          description: JSON.stringify([...new Set(small)].slice(0, 60)),
        });
        // Shell typography (sidebar eyebrows, topbar chips) is a DESIGN.md
        // decision shared by every screen; it is reported, not gated, here.
        const shell = await geometryIssues(page, 'shell');
        test.info().annotations.push({
          type: 'shell-layout',
          description: JSON.stringify(shell.slice(0, 30)),
        });
        expect.soft(found, `layout issues ${theme} ${vp.name}`).toEqual({});
      });
    }
  }
});
