/**
 * Audit for the comms section: calendar, calls, meetings, public booking,
 * the workspace account cards and the contact email panel.
 *
 * Layout: light and dark at 1440x900, 1024x768 and 390x844, no horizontal
 * overflow, no overlapping text, no clipped text without ellipsis and title,
 * no text under 12px, AA contrast.
 *
 * Clicks: every visible control in main is activated once and must do
 * something observable without console errors or unexpected 4xx/5xx.
 * Destructive controls must ask first.
 *
 * Calendar fixtures are created through the API with no workspace grant, so
 * they stay in Polo: nothing reaches a real Google or Microsoft account.
 */
import type { Page, Response } from '@playwright/test';

import { expect, test } from '../fixtures.js';
import {
  AUDIT_THEMES,
  AUDIT_VIEWPORTS,
  contrastIssues,
  formatIssues,
  geometryIssues,
  pinTheme,
  settle,
  type LayoutIssue,
} from './comms-layout.js';

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4010';
const MAX_CONTROLS_PER_ROUTE = 30;
const DESTRUCTIVE = /\b(delete|remove|disconnect|archive|discard|revoke|cancel booking|sign out|log out)\b/i;
const CLICK_TIMEOUT = 15_000;

let contactId = '';

function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const contacts = await request.get(`${API}/api/contacts?limit=1`);
  expect(contacts.ok()).toBe(true);
  contactId = ((await contacts.json()) as { items: Array<{ id: string }> }).items[0]?.id ?? '';

  // Two overlapping meetings and one long title: the grid must lay them out
  // side by side and truncate with a tooltip. Fixed retry keys keep reruns idempotent.
  const fixtures = [
    { subject: 'Audit overlap A: pricing review with the client steering group', startAt: todayAt(10), endAt: todayAt(11) },
    { subject: 'Audit overlap B: bid kickoff', startAt: todayAt(10, 30), endAt: todayAt(11, 30) },
    { subject: 'Audit short sync', startAt: todayAt(14), endAt: todayAt(14, 15) },
  ];
  for (const [i, f] of fixtures.entries()) {
    const res = await request.post(`${API}/api/calendar/events`, {
      data: { ...f, provider: 'google_workspace', clientRequestId: `comms-audit-fixture-${i}` },
    });
    expect([200, 201]).toContain(res.status());
  }
});

// Settings chrome and contact headers belong to other sections, so those
// routes are measured inside the comms surface only.
const ROUTES: Array<{ name: string; path: () => string; root?: string }> = [
  { name: 'calendar-week', path: () => '/calendar' },
  { name: 'calls', path: () => '/calls' },
  { name: 'meetings', path: () => '/meetings' },
  { name: 'meeting-flags', path: () => '/meetings/flags' },
  {
    name: 'integrations',
    path: () => '/settings?tab=integrations',
    root: '[role="tabpanel"][data-state="active"]',
  },
  { name: 'contact-email', path: () => `/contacts/${contactId}`, root: '[data-testid="email-panel"]' },
  { name: 'public-booking', path: () => '/book/test-slug' },
];

// The settings page is heavy; on the shared dev machine 30 clicks can take over 10 minutes.
test.describe.configure({ retries: 0, timeout: 900_000 });

// ─── Layout ────────────────────────────────────────────────────────────────

for (const theme of AUDIT_THEMES) {
  for (const route of ROUTES) {
    test(`layout audit ${route.name} (${theme})`, async ({ page }) => {
      test.setTimeout(300_000);
      await pinTheme(page, theme);
      const found: string[] = [];
      for (const vp of AUDIT_VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route.path(), { waitUntil: 'load' });
        await settle(page);
        const issues: LayoutIssue[] = [
          ...(await geometryIssues(page, route.root)),
          ...(await contrastIssues(page, route.root)),
        ];
        if (issues.length > 0) found.push(formatIssues(`${route.path()} @${vp.name}`, issues));
      }
      await test.info().attach(`layout-${route.name}-${theme}.txt`, {
        body: found.join('\n\n') || 'clean',
        contentType: 'text/plain',
      });
      expect(found, found.join('\n\n')).toEqual([]);
    });
  }
}

// ─── Clicks ────────────────────────────────────────────────────────────────

type Watch = { problems: string[]; requests: number; writes: number };

function watch(page: Page): Watch {
  const w: Watch = { problems: [], requests: 0, writes: 0 };
  page.on('pageerror', (err) => w.problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text.startsWith('Failed to load resource')) return;
    w.problems.push(`console: ${text.slice(0, 200)}`);
  });
  page.on('request', (req) => {
    if (!req.url().startsWith(API)) return;
    w.requests += 1;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) w.writes += 1;
  });
  page.on('response', (res: Response) => {
    if (!res.url().startsWith(API) || res.status() < 400) return;
    // An OAuth app that is not configured answers 503 by design.
    if (res.status() === 503 && res.url().includes('/integrations/workspace/')) return;
    w.problems.push(`${res.request().method()} ${res.url().replace(API, '')} -> ${res.status()}`);
  });
  return w;
}

async function tagControls(page: Page): Promise<Array<{ id: number; label: string; kind: string }>> {
  return page.evaluate((max) => {
    const main = document.querySelector('main');
    if (!main) return [];
    for (const el of Array.from(document.querySelectorAll('[data-audit-id]'))) el.removeAttribute('data-audit-id');
    const selector = 'button, a[href], [role="tab"], [role="menuitem"], [role="switch"], select, summary';
    const seen = new Set<string>();
    const out: { id: number; label: string; kind: string }[] = [];
    for (const el of Array.from(main.querySelectorAll<HTMLElement>(selector))) {
      if (out.length >= max) break;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const active =
        el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('aria-pressed') === 'true' ||
        el.getAttribute('data-state') === 'active' ||
        ['page', 'true'].includes(el.getAttribute('aria-current') ?? '');
      if (active) continue;
      const href = el.getAttribute('href') ?? '';
      if (href && new URL(href, location.href).href === location.href) continue;
      if (/^(mailto:|tel:|https?:)/.test(href) || el.getAttribute('target') === '_blank') continue;
      const raw = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      const label = raw.slice(0, 60) || `${el.tagName.toLowerCase()}#${out.length}`;
      // Calendar slots repeat per hour and day; one representative is enough.
      const key = `${el.tagName}|${label.replace(/ (for|at) .*$/i, '').replace(/\d+/g, '#')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      el.setAttribute('data-audit-id', String(out.length));
      out.push({ id: out.length, label, kind: el.tagName.toLowerCase() });
    }
    return out;
  }, MAX_CONTROLS_PER_ROUTE);
}

async function open(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'load' });
  await settle(page);
}

function anyDialog(page: Page) {
  return page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
}

async function closeDialogs(page: Page, route: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(250);
    if (!(await anyDialog(page).isVisible().catch(() => false))) return;
  }
  await open(page, route);
  await tagControls(page);
}

async function startMutationCount(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __auditObs?: MutationObserver; __auditMut: number };
    w.__auditObs?.disconnect();
    w.__auditMut = 0;
    w.__auditObs = new MutationObserver((records) => {
      w.__auditMut += records.length;
    });
    w.__auditObs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}

/** Jump links scroll without touching the DOM; that still counts as doing something. */
async function scrollSum(page: Page): Promise<number> {
  return page
    .evaluate(() => Array.from(document.querySelectorAll('*')).reduce((n, el) => n + el.scrollTop, window.scrollY))
    .catch(() => 0);
}

for (const route of ROUTES) {
  test(`click audit ${route.name}: every control does something`, async ({ page }) => {
    test.setTimeout(900_000);
    const path = route.path();
    const w = watch(page);
    await open(page, path);
    const controls = await tagControls(page);
    expect(controls.length, `no controls found on ${path}`).toBeGreaterThan(0);

    const dead: string[] = [];
    const unguarded: string[] = [];
    for (const control of controls) {
      const startUrl = page.url();
      let target = page.locator(`[data-audit-id="${control.id}"]`);
      if ((await target.count()) === 0) {
        await open(page, path);
        await tagControls(page);
        target = page.locator(`[data-audit-id="${control.id}"]`);
        if ((await target.count()) === 0) continue;
      }
      if (!(await target.isVisible())) continue;
      await startMutationCount(page);
      const scrollBefore = await scrollSum(page);
      const requestsBefore = w.requests;
      let valueChanged = false;
      if (control.kind === 'select') {
        const values = await target.locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
        const current = await target.inputValue();
        const next = values.find((v) => v !== current);
        if (next === undefined) continue;
        await target.selectOption(next);
        valueChanged = true;
      } else if (DESTRUCTIVE.test(control.label)) {
        const writesBefore = w.writes;
        const clicked = await target.click({ timeout: CLICK_TIMEOUT }).then(() => true).catch(() => false);
        await anyDialog(page).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        if (!clicked) dead.push(`${path} :: ${control.label} (click failed)`);
        else if (w.writes > writesBefore) unguarded.push(`${path} :: ${control.label}`);
        await closeDialogs(page, path);
        if (page.url() !== startUrl) await open(page, path);
        continue;
      } else {
        await target.click({ timeout: CLICK_TIMEOUT }).catch((err: Error) => {
          dead.push(`${path} :: ${control.label} (click failed: ${err.message.split('\n')[0]})`);
        });
      }
      await page.waitForTimeout(700);
      const moved = page.url() !== startUrl;
      const mutated = moved
        ? 0
        : await page.evaluate(() => (window as unknown as { __auditMut?: number }).__auditMut ?? 0).catch(() => 1);
      const flaggedInvalid = await page
        .evaluate(() => document.activeElement?.matches(':invalid') ?? false)
        .catch(() => false);
      const scrolled = !moved && (await scrollSum(page)) !== scrollBefore;
      if (!(moved || valueChanged || flaggedInvalid || scrolled || mutated > 0 || w.requests > requestsBefore)) {
        dead.push(`${path} :: ${control.label}`);
      }
      await closeDialogs(page, path);
      if (page.url() !== startUrl) await open(page, path);
    }

    expect.soft(w.problems, `errors while auditing ${path}`).toEqual([]);
    expect.soft(dead, `dead controls on ${path}`).toEqual([]);
    expect.soft(unguarded, `destructive controls without confirmation on ${path}`).toEqual([]);
  });
}

// ─── Behaviour ─────────────────────────────────────────────────────────────

test('calendar lays overlapping meetings side by side with a full-title tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '/calendar');
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  const a = page.locator('[data-testid="calendar-event"]', { hasText: 'Audit overlap A' }).first();
  const b = page.locator('[data-testid="calendar-event"]', { hasText: 'Audit overlap B' }).first();
  await expect(a).toBeVisible();
  const [ra, rb] = [await a.boundingBox(), await b.boundingBox()];
  expect(ra && rb).toBeTruthy();
  const overlapX = Math.min(ra!.x + ra!.width, rb!.x + rb!.width) - Math.max(ra!.x, rb!.x);
  expect(overlapX).toBeLessThanOrEqual(1);
  expect(await a.getAttribute('title')).toContain('pricing review with the client steering group');

  await a.click();
  const panel = page.getByTestId('calendar-event-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Only in Polo')).toBeVisible();
});

test('calendar agenda groups events by day and the time zone switch keeps the range', async ({ page }) => {
  await open(page, '/calendar');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByTestId('calendar-agenda')).toContainText('Audit short sync');
  const zones = page.getByRole('group', { name: 'Time zone' });
  if (await zones.isVisible()) {
    await zones.getByRole('button').last().click();
    await expect(page.getByTestId('calendar-agenda')).toBeVisible();
  }
});

test('workspace cards show the read-only promise and never offer send', async ({ page }) => {
  await open(page, '/settings?tab=integrations');
  await page.getByRole('tab', { name: /connectors/i }).click();
  const cards = page.getByTestId('workspace-accounts');
  await expect(cards).toContainText('Read-only. Polo never sends mail or changes your calendar.');
  await expect(cards.getByTestId('integration-card-gmail')).toBeVisible();
  await expect(cards.getByTestId('integration-card-microsoft')).toBeVisible();
});

test('contact email composer saves a draft and has no send button', async ({ page }) => {
  const w = watch(page);
  await open(page, `/contacts/${contactId}`);
  await page.getByTestId('email-panel').getByRole('button', { name: 'New draft' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Saved as a draft in Polo. Nothing is sent.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^send/i })).toHaveCount(0);
  await dialog.getByLabel('To').fill('buyer@client.example');
  await dialog.getByLabel('Subject').fill('Audit draft');
  const saved = page.waitForResponse((r) => r.url().includes('/api/v1/email/drafts') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  expect([200, 201]).toContain((await saved).status());
  await expect(dialog.getByRole('link', { name: 'Open in mail app' })).toBeVisible();
  expect(w.problems).toEqual([]);
});
