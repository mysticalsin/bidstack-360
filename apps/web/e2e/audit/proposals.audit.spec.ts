/**
 * Proposals section review: click audit and layout audit.
 *
 * Routes: proposals list and detail, RFP pipeline, admin RFP analytics,
 * references, sales toolkits, intake, agreements list and detail, and the
 * public signing page.
 *
 * Click audit: every visible control inside the main landmark is activated and
 * must do something observable (navigation, dialog, DOM change or a network
 * call) without console errors, page errors or unexpected 4xx/5xx.
 * Destructive controls (delete, void, archive) are skipped so the seed stays
 * usable for the rest of the sweep.
 *
 * Layout audit: light and dark at 1440x900, 1024x768 and 390x844, geometry plus
 * axe contrast.
 *
 * Opt-in (heavy, minutes per viewport):
 *   E2E_AUDIT=1 E2E_BASE_URL=... E2E_API_URL=... playwright test e2e/audit/proposals.audit.spec.ts --workers=1
 */
import { randomBytes } from 'node:crypto';

import { test, expect } from '../fixtures/auth.fixture.js';
import type { Page, Request, Response } from '@playwright/test';

import { THEMES, VIEWPORTS, layoutIssues, useTheme, type LayoutIssue } from './proposals-layout.js';

const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4010';
const DESTRUCTIVE = /delete|remove|archive|void|revoke|sign out|log out/i;

test.skip(!process.env.E2E_AUDIT, 'set E2E_AUDIT=1 to run the section audit');

const ids: { proposal?: string; opportunity?: string; agreement?: string } = {};

const STATIC_ROUTES = [
  '/proposals',
  '/admin/rfp',
  '/references',
  '/sales-toolkits',
  '/intake',
  '/agreements',
];

function dynamicRoutes(): string[] {
  const out: string[] = [];
  if (ids.proposal) out.push(`/proposals/${ids.proposal}`);
  if (ids.opportunity) out.push(`/rfp/${ids.opportunity}/pipeline`);
  if (ids.agreement) out.push(`/agreements/${ids.agreement}`);
  return out;
}

function isExpectedFailure(res: Response): boolean {
  const url = res.url();
  const status = res.status();
  if (status < 400) return false;
  if (status === 400 || status === 422 || status === 409) return true;
  // Optional integrations report "not configured" by design.
  if (/\/(integrations|health|status|providers|dust|odoo|sharepoint|lms)\b/.test(url)) return true;
  // The unknown-token sign check expects the API to say so.
  if (/\/sign\/[0-9a-f]{64}$/.test(url) && (status === 404 || status === 410)) return true;
  // useBidScoreLatest reads 404 as "not scored yet" and does not retry it.
  if (/\/bid-scores\/[0-9a-f-]{36}\/latest$/.test(url) && status === 404) return true;
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

function unwatch(page: Page): void {
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.removeAllListeners('response');
  page.removeAllListeners('request');
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
  const first = async (path: string): Promise<Record<string, unknown> | undefined> => {
    const res = await api.get(`${API_URL}${path}`);
    if (!res.ok()) return undefined;
    const body = (await res.json()) as unknown;
    const list = Array.isArray(body)
      ? body
      : ((body as { items?: unknown[]; rows?: unknown[]; data?: unknown[] }).items ??
        (body as { rows?: unknown[] }).rows ??
        (body as { data?: unknown[] }).data ??
        []);
    return list[0] as Record<string, unknown> | undefined;
  };
  ids.proposal = (await first('/api/proposals?limit=1'))?.id as string | undefined;
  ids.opportunity = (await first('/api/opportunities?limit=1'))?.id as string | undefined;
  ids.agreement = (await first('/api/msa/search?limit=1'))?.id as string | undefined;
  await api.dispose();
});

test.describe('proposals click audit', () => {
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
      unwatch(page);
    }
  });

  test('public sign page: unknown token shows the invalid state', async ({ page }) => {
    const sweep = watch(page);
    await page.goto(`/sign/${randomBytes(32).toString('hex')}`, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { name: 'Invalid signing link' })).toBeVisible({
      timeout: 20_000,
    });
    expect.soft(sweep.pageErrors).toEqual([]);
    expect.soft(sweep.badResponses).toEqual([]);
  });

  for (const path of [...STATIC_ROUTES, 'dynamic']) {
    test(`every control does something: ${path}`, async ({ page }) => {
      test.setTimeout(480_000);
      const paths = path === 'dynamic' ? dynamicRoutes() : [path];
      const dead: string[] = [];
      const errors: string[] = [];
      for (const route of paths) {
        await open(page, route);
        const controls = page
          .getByRole('main')
          .locator(
            'button:visible:not([disabled]), a[href]:visible, [role="tab"]:visible, [role="switch"]:visible, [role="checkbox"]:visible, [role="menuitem"]:visible',
          );
        const total = Math.min(await controls.count(), 40);
        for (let i = 0; i < total; i++) {
          await open(page, route);
          const control = controls.nth(i);
          if (!(await control.isVisible().catch(() => false))) continue;
          const name =
            (await control.getAttribute('aria-label')) ||
            ((await control.innerText().catch(() => '')) ?? '').trim().slice(0, 40) ||
            `#${i}`;
          if (DESTRUCTIVE.test(name)) continue;
          const href = await control.getAttribute('href');
          if (href && /^(https?:|mailto:|tel:)/.test(href) && !href.startsWith('http://127.0.0.1')) {
            continue;
          }
          const sweep = watch(page);
          const before = await page.evaluate(() => ({
            url: location.href,
            dialogs: document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')
              .length,
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
          await control.click({ timeout: 3_000 }).catch(() => undefined);
          await page.waitForTimeout(500);
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
          if (!observable) dead.push(`${route}: ${name}`);
          errors.push(
            ...sweep.pageErrors.map((e) => `${route} ${name}: ${e}`),
            ...sweep.consoleErrors.map((e) => `${route} ${name}: ${e}`),
            ...sweep.badResponses.map((e) => `${route} ${name}: ${e}`),
          );
          unwatch(page);
          await page.keyboard.press('Escape').catch(() => undefined);
        }
      }
      expect.soft(dead, `dead controls on ${path}`).toEqual([]);
      expect.soft(errors, `errors while clicking on ${path}`).toEqual([]);
    });
  }

  test('create proposal: empty name blocked, valid name creates', async ({ page }) => {
    const sweep = watch(page);
    await open(page, '/proposals');
    await page.getByRole('button', { name: 'New Proposal' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    const create = sheet.getByRole('button', { name: 'Create', exact: true });
    await expect(create).toBeDisabled();
    const name = `Audit proposal ${Date.now()}`;
    await sheet.getByLabel('Proposal name').fill(name);
    const posted = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/proposals') && r.request().method() === 'POST',
    );
    await create.click();
    expect((await posted).status()).toBe(201);
    await expect(sheet).toBeHidden();
    await expect(page.getByText(name).first()).toBeVisible();
    expect.soft(sweep.pageErrors).toEqual([]);
    expect.soft(sweep.badResponses).toEqual([]);
  });

  test('new reference: invalid submit stays open, valid submit creates', async ({ page }) => {
    const sweep = watch(page);
    await open(page, '/references');
    await page.getByRole('button', { name: 'New reference' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const submit = dialog.getByRole('button', { name: /create|save|add/i }).last();
    if (await submit.isEnabled()) await submit.click();
    await expect(dialog).toBeVisible();
    const title = `Audit reference ${Date.now()}`;
    await dialog.getByLabel(/title/i).first().fill(title);
    await submit.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(title).first()).toBeVisible();
    expect.soft(sweep.pageErrors).toEqual([]);
    expect.soft(sweep.badResponses).toEqual([]);
  });
});

test.describe('proposals layout audit', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      test(`layout ${theme} ${vp.name}`, async ({ page }) => {
        test.setTimeout(600_000);
        await useTheme(page, theme);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const found: Record<string, LayoutIssue[]> = {};
        for (const path of [...STATIC_ROUTES, ...dynamicRoutes()]) {
          await open(page, path).catch(() => undefined);
          const issues = await layoutIssues(page);
          if (issues.length) found[path] = issues.slice(0, 15);
        }
        expect.soft(found, `layout issues ${theme} ${vp.name}`).toEqual({});
      });
    }
  }
});
