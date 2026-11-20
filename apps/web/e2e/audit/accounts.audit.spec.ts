/**
 * Click audit for the accounts section: accounts, org chart, companies,
 * contacts, leads, KAM, territories, search and workload.
 *
 * Every visible control inside `main` is activated once. Each activation must
 * produce something observable (navigation, DOM change, network call or a
 * download) without a console error, a page error or an unexpected API
 * 4xx/5xx. Destructive controls are not executed; instead the spec checks
 * that they ask for confirmation first. Forms are submitted invalid and valid.
 */
import type { Page, Response } from '@playwright/test';

import { expect, test } from '../fixtures.js';
import { settle } from './accounts-layout.js';

// Clicks every control (status selects, territory toggles, ERP sync), so it
// writes to the seed and runs for minutes: opt in, never in the sharded suite.
test.skip(process.env.E2E_AUDIT !== '1', 'set E2E_AUDIT=1 to run the accounts audits');

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4010';
const MAX_CONTROLS_PER_ROUTE = 30;
const DESTRUCTIVE = /\b(delete|remove|archive|disqualify|merge|convert|discard|revoke|sign out|log out|clear all)\b/i;

type Ids = { companyId: string; contactId: string; leadId: string };
let ids: Ids;

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const first = async (path: string): Promise<string> => {
    const res = await request.get(`${API}${path}`);
    expect(res.ok(), `${path} -> ${res.status()}`).toBe(true);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    const id = body.items[0]?.id;
    if (!id) throw new Error(`seed has no rows for ${path}`);
    return id;
  };
  ids = {
    companyId: await first('/api/companies?limit=1'),
    contactId: await first('/api/contacts?limit=1'),
    // An unconverted lead: converted leads keep their status option.
    leadId: await first('/api/leads?limit=1&status=new'),
  };
});

function routes(): string[] {
  return [
    '/accounts',
    '/accounts?view=key',
    '/accounts?view=top',
    `/accounts/${ids.companyId}/org-chart`,
    '/companies',
    `/companies/${ids.companyId}`,
    '/contacts',
    `/contacts/${ids.contactId}`,
    '/leads',
    '/leads/new',
    `/leads/${ids.leadId}`,
    '/kam',
    '/territories',
    '/search?q=north',
    '/workload',
  ];
}

type Watch = { problems: string[]; requests: number; writes: number; downloads: number };

function watch(page: Page): Watch {
  const w: Watch = { problems: [], requests: 0, writes: 0, downloads: 0 };
  page.on('pageerror', (err) => w.problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Failed responses are reported once, with their URL, by the response hook.
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
    w.problems.push(`${res.request().method()} ${res.url().replace(API, '')} -> ${res.status()}`);
  });
  page.on('download', () => {
    w.downloads += 1;
  });
  return w;
}

type Control = { id: number; label: string; kind: string };

/** Tag visible, enabled controls in main and return one per distinct label. */
async function tagControls(page: Page): Promise<Control[]> {
  return page.evaluate((max) => {
    // The org chart is a full-screen portal above the (empty) shell main.
    const main =
      document.querySelector<HTMLElement>('[data-testid="orgchart-page"]') ??
      document.querySelector('main');
    if (!main) return [];
    for (const el of Array.from(document.querySelectorAll('[data-audit-id]'))) {
      el.removeAttribute('data-audit-id');
    }
    const selector = [
      'button',
      'a[href]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="switch"]',
      '[role="checkbox"]',
      'input[type="checkbox"]',
      'select',
      'summary',
    ].join(',');
    const seen = new Set<string>();
    const out: { id: number; label: string; kind: string }[] = [];
    for (const el of Array.from(main.querySelectorAll<HTMLElement>(selector))) {
      if (out.length >= max) break;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      // 1px boxes are screen-reader-only controls (sr-only clip), not pointer targets.
      if (r.width <= 1 || r.height <= 1 || s.visibility === 'hidden') continue;
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue;
      // Re-activating the current tab, chip or nav item is a no-op by design.
      const active =
        el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('aria-pressed') === 'true' ||
        el.getAttribute('aria-checked') === 'true' ||
        el.getAttribute('data-state') === 'active' ||
        ['page', 'true'].includes(el.getAttribute('aria-current') ?? '');
      if (active) continue;
      const href = el.getAttribute('href') ?? '';
      if (href && new URL(href, location.href).href === location.href) continue;
      if (/^(mailto:|tel:|https?:)/.test(href) || el.getAttribute('target') === '_blank') continue;
      const raw =
        el.getAttribute('aria-label') ??
        el.getAttribute('title') ??
        (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      const label = raw.slice(0, 60) || `${el.tagName.toLowerCase()}#${out.length}`;
      // Row actions repeat per row ("Edit status for Jane", "... for Bob"):
      // exercising one representative is enough.
      const key = `${el.tagName}|${label.replace(/ for .*$/i, '').replace(/\d+/g, '#')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = out.length;
      el.setAttribute('data-audit-id', String(id));
      out.push({ id, label, kind: el.tagName.toLowerCase() });
    }
    return out;
  }, MAX_CONTROLS_PER_ROUTE);
}

async function open(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'load' });
  await settle(page);
}

// The shared dev machine runs several stacks; 5 s clicks flake under load.
const CLICK_TIMEOUT = 15_000;

function anyDialog(page: Page) {
  return page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
}

/** Escape out of any dialog or menu; reload the route if one will not close. */
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
    w.__auditObs.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
}

async function mutationCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __auditMut?: number }).__auditMut ?? 0);
}

test.describe.configure({ retries: 0, timeout: 600_000 });

const ROUTE_NAMES = [
  'accounts',
  'accounts key',
  'accounts top',
  'org chart',
  'companies',
  'company detail',
  'contacts',
  'contact detail',
  'leads',
  'new lead',
  'lead detail',
  'kam',
  'territories',
  'search',
  'workload',
];

for (const [index, name] of ROUTE_NAMES.entries()) {
  test(`click audit ${name}: every control does something`, async ({ page }) => {
    test.setTimeout(600_000);
    const route = routes()[index]!;
    const w = watch(page);
    await open(page, route);
    const controls = await tagControls(page);
    expect(controls.length, `no controls found on ${route}`).toBeGreaterThan(0);

    const dead: string[] = [];
    const unguarded: string[] = [];
    for (const control of controls) {
      const startUrl = page.url();
      // Ids are positional and shift after any reload, so resolve by label.
      // A control that is now active (an earlier click switched to it) drops out.
      const live = (await tagControls(page)).find(
        (c) => c.label === control.label && c.kind === control.kind,
      );
      if (!live) continue;
      const target = page.locator(`[data-audit-id="${live.id}"]`);
      if (!(await target.isVisible())) continue;
      await target.hover({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(150);
      await startMutationCount(page);
      const requestsBefore = w.requests;
      const downloadsBefore = w.downloads;

      let valueChanged = false;
      if (control.kind === 'select') {
        const values = await target.locator('option').evaluateAll((opts) =>
          opts.map((o) => (o as HTMLOptionElement).value),
        );
        const current = await target.inputValue();
        const next = values.find((v) => v !== current);
        if (next === undefined) continue;
        await target.selectOption(next);
        valueChanged = (await target.inputValue()) === next;
      } else if (DESTRUCTIVE.test(control.label)) {
        // Guarded = the click alone writes nothing (a dialog or an inline form
        // asks first). One click that fires a write is the bug.
        const writesBefore = w.writes;
        const clicked = await target
          .click({ timeout: CLICK_TIMEOUT })
          .then(() => true)
          .catch(() => false);
        await anyDialog(page)
          .waitFor({ state: 'visible', timeout: 5_000 })
          .catch(() => undefined);
        await page.waitForTimeout(500);
        if (!clicked) dead.push(`${route} :: ${control.label} (click failed)`);
        else if (w.writes > writesBefore) unguarded.push(`${route} :: ${control.label}`);
        await closeDialogs(page, route);
        if (page.url() !== startUrl) await open(page, route);
        continue;
      } else {
        await target.click({ timeout: CLICK_TIMEOUT }).catch((err: Error) => {
          dead.push(`${route} :: ${control.label} (click failed: ${err.message.split('\n')[0]})`);
        });
      }
      await page.waitForTimeout(700);
      const moved = page.url() !== startUrl;
      const mutated = moved ? 0 : await mutationCount(page).catch(() => 1);
      // Native constraint validation focuses the first invalid field without a DOM change.
      const flaggedInvalid = await page
        .evaluate(() => document.activeElement?.matches(':invalid') ?? false)
        .catch(() => false);
      let observable =
        moved ||
        valueChanged ||
        flaggedInvalid ||
        mutated > 0 ||
        w.requests > requestsBefore ||
        w.downloads > downloadsBefore;
      if (!observable && control.kind !== 'select') {
        // One slower retry on a fresh page before calling it dead: render
        // work can exceed the first window when the machine is loaded.
        await open(page, route);
        // Ids are positional and async sections can shift them; match by label.
        const retagged = await tagControls(page);
        const match = retagged.find((c) => c.label === control.label && c.kind === control.kind);
        const again = page.locator(`[data-audit-id="${match?.id ?? -1}"]`);
        if ((await again.count()) > 0) {
          await startMutationCount(page);
          const reqs = w.requests;
          await again.click({ timeout: CLICK_TIMEOUT }).catch(() => undefined);
          await page.waitForTimeout(2_500);
          observable =
            page.url() !== startUrl || (await mutationCount(page).catch(() => 1)) > 0 || w.requests > reqs;
        }
      }
      if (!observable) dead.push(`${route} :: ${control.label}`);

      await closeDialogs(page, route);
      if (page.url() !== startUrl) await open(page, route);
    }

    expect.soft(w.problems, `errors while auditing ${route}`).toEqual([]);
    expect.soft(dead, `dead controls on ${route}`).toEqual([]);
    expect.soft(unguarded, `destructive controls without confirmation on ${route}`).toEqual([]);
  });
}

test('new lead form: invalid submit flags fields, valid submit creates the lead', async ({ page }) => {
  const w = watch(page);
  await open(page, '/leads/new');
  const first = page.locator('#lead-first-name');
  await page.getByRole('button', { name: 'Create lead' }).click();
  // Empty required fields: native validation blocks the submit and focuses the field.
  await expect(first).toBeFocused();
  expect(await first.evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);

  // Whitespace passes native validation; the form's own check flags it.
  await first.fill('   ');
  await page.locator('#lead-last-name').fill('   ');
  await page.locator('#lead-company').fill('   ');
  await page.getByRole('button', { name: 'Create lead' }).click();
  await expect(first).toHaveAttribute('aria-invalid', 'true');

  await first.fill('Audit');
  await page.locator('#lead-last-name').fill('Prospect');
  await page.locator('#lead-company').fill('Audit Systems');
  await page.locator('#lead-score').fill('55');
  const created = page.waitForResponse(
    (r) => /\/api\/(v1\/)?leads$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Create lead' }).click();
  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
  expect(w.problems).toEqual([]);
});

test('lead detail: score edits save once on blur', async ({ page }) => {
  const w = watch(page);
  await open(page, `/leads/${ids.leadId}`);
  const score = page.getByLabel('Score', { exact: true });
  const target = (await score.inputValue()) === '64' ? '65' : '64';
  await score.fill(target);
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith(`/leads/${ids.leadId}`) && r.request().method() === 'PATCH',
    { timeout: 30_000 },
  );
  await score.blur();
  const res = await saved;
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { score: number }).score).toBe(Number(target));
  await expect(score).toHaveValue(target);
  await expect(page.getByLabel('Status', { exact: true }).locator('option[value="converted"]')).toHaveCount(0);
  expect(w.problems).toEqual([]);
});

test('global search opens a CRM company account page', async ({ page }) => {
  const w = watch(page);
  await open(page, '/search?q=northwind');
  const companyLink = page.locator('main a[href^="/accounts/"]').first();
  await expect(companyLink).toBeVisible();
  const href = await companyLink.getAttribute('href');
  const res = await page.request.get(`${API}/api/companies/${href!.split('/').pop()}`);
  expect(res.status()).toBe(200);
  expect(w.problems).toEqual([]);
});
