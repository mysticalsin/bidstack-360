/**
 * Layout contract for the accounts list, account pages and company pages at
 * 1440, 1024, 768 and 390 wide (DESIGN.md 9.11). For every tab on the page:
 * the tab is clickable (tab strips scroll instead of clipping), no two visible
 * text runs overlap, and any text clipped with an ellipsis or line clamp has a
 * title so the full value is one hover away.
 *
 * Overlap uses one rect per rendered line (range.getClientRects), clipped to
 * overflow ancestors, and ignores pairs where an opaque positioned layer (a
 * sticky bar, an overlay) paints between the two runs.
 */
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures.js';
import { settle } from './accounts-layout.js';

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4010';
const VIEWPORTS = [1440, 1024, 768, 390] as const;

test.describe.configure({ retries: 0, timeout: 300_000 });
test.skip(process.env.E2E_AUDIT !== '1', 'set E2E_AUDIT=1 to run the account and company layout contract');

let companyIds: string[] = [];

test.beforeAll(async ({ request }) => {
  const res = await request.get(`${API}/api/companies?limit=3`);
  expect(res.ok(), `/api/companies -> ${res.status()}`).toBe(true);
  companyIds = ((await res.json()) as { items: Array<{ id: string }> }).items.map((c) => c.id);
  if (companyIds.length === 0) throw new Error('seed has no companies');
});

type Finding = { kind: 'overlap' | 'clipped-no-title'; detail: string };

async function layoutFindings(page: Page): Promise<Finding[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
  });
  return page.evaluate(() => {
    const findings: { kind: 'overlap' | 'clipped-no-title'; detail: string }[] = [];
    const visible = (el: Element): boolean => {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      return !el.closest('[aria-hidden="true"], .sr-only, .skip-link, svg, [role="tooltip"]');
    };
    const label = (el: Element): string => {
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${text}"`;
    };
    const clipFor = (el: Element) => {
      const r = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
      for (let e: Element | null = el; e && e !== document.documentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        const b = e.getBoundingClientRect();
        if (s.overflowX !== 'visible') {
          r.l = Math.max(r.l, b.left);
          r.r = Math.min(r.r, b.right);
        }
        if (s.overflowY !== 'visible') {
          r.t = Math.max(r.t, b.top);
          r.b = Math.min(r.b, b.bottom);
        }
      }
      return r;
    };

    type Run = { el: Element; l: number; t: number; r: number; b: number };
    const runs: Run[] = [];
    const root = document.querySelector('main') ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !(n.textContent ?? '').trim() || !visible(el)) continue;
      if (el.closest('script, style, noscript, option, textarea')) continue;
      const clip = clipFor(el);
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const cr of Array.from(range.getClientRects())) {
        const l = Math.max(cr.left, clip.l);
        const t = Math.max(cr.top, clip.t);
        const r = Math.min(cr.right, clip.r);
        const b = Math.min(cr.bottom, clip.b);
        if (r - l >= 1 && b - t >= 1) runs.push({ el, l, t, r, b });
      }
    }

    const opaqueLayer = (e: Element): boolean => {
      const cs = getComputedStyle(e);
      if (cs.position === 'static') return false;
      const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (!m) return false;
      const parts = m[1]!.split(/[ ,/]+/).filter(Boolean);
      return parts.length < 4 || Number(parts[3]) > 0.85;
    };
    const occluded = (a: Run, b: Run): boolean => {
      const cx = (Math.max(a.l, b.l) + Math.min(a.r, b.r)) / 2;
      const cy = (Math.max(a.t, b.t) + Math.min(a.b, b.b)) / 2;
      if (cy < 0 || cy > innerHeight) return false;
      const stack = document.elementsFromPoint(cx, cy);
      const ia = stack.findIndex((e) => e === a.el || a.el.contains(e));
      const ib = stack.findIndex((e) => e === b.el || b.el.contains(e));
      if (ia < 0 || ib < 0) return false;
      const [hi, lo, lower] = ia < ib ? [ia, ib, b.el] : [ib, ia, a.el];
      for (let i = hi + 1; i < lo; i += 1) {
        const e = stack[i]!;
        if (!e.contains(lower) && opaqueLayer(e)) return true;
      }
      return false;
    };

    runs.sort((x, y) => x.t - y.t);
    const seen = new Set<string>();
    for (let i = 0; i < runs.length; i += 1) {
      const a = runs[i]!;
      for (let j = i + 1; j < runs.length && runs[j]!.t < a.b - 2; j += 1) {
        const b = runs[j]!;
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ox <= 2 || oy <= 2 || occluded(a, b)) continue;
        const key = `${label(a.el)} overlaps ${label(b.el)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ kind: 'overlap', detail: key });
      }
    }

    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (el.clientWidth === 0 || !visible(el)) continue;
      const s = getComputedStyle(el);
      const ellipsis = s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      const clamped =
        s.webkitLineClamp !== 'none' && s.webkitLineClamp !== '' && el.scrollHeight > el.clientHeight + 2;
      if (!ellipsis && !clamped) continue;
      if (el.closest('[title]') || el.querySelector('[title]') || el.getAttribute('aria-label')) continue;
      findings.push({ kind: 'clipped-no-title', detail: label(el) });
    }
    return findings;
  });
}

const ROUTES: Array<{ name: string; path: () => string; tabs: boolean }> = [
  { name: 'accounts list', path: () => '/accounts', tabs: false },
  ...[0, 1, 2].flatMap((i) => [
    { name: `account ${i + 1}`, path: () => `/accounts/${companyIds[i] ?? companyIds[0]}`, tabs: true },
    { name: `company ${i + 1}`, path: () => `/companies/${companyIds[i] ?? companyIds[0]}`, tabs: true },
  ]),
];

for (const width of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`layout contract ${route.name} @${width}`, async ({ page }) => {
      await page.addInitScript(() => {
        try {
          localStorage.setItem('bidstack:onboarding-tour-seen', '1');
        } catch {
          /* storage unavailable */
        }
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route.path(), { waitUntil: 'load' });
      await settle(page);
      const problems: string[] = [];
      const record = (state: string, found: Finding[]) => {
        for (const f of found) problems.push(`${state} [${f.kind}] ${f.detail}`);
      };
      record('initial', await layoutFindings(page));

      if (route.tabs) {
        const tabs = page.getByRole('main').getByRole('tab');
        const count = await tabs.count();
        for (let i = 0; i < count; i += 1) {
          const tab = tabs.nth(i);
          const name = ((await tab.innerText()) || `tab ${i}`).replace(/\s+/g, ' ').trim();
          try {
            await tab.scrollIntoViewIfNeeded({ timeout: 2_000 });
            await tab.click({ timeout: 3_000 });
          } catch (err) {
            problems.push(`tab "${name}" is not clickable: ${String(err).split('\n')[0]}`);
            continue;
          }
          await expect(tab).toHaveAttribute('aria-selected', 'true');
          await settle(page);
          record(`tab "${name}"`, await layoutFindings(page));
        }
      }

      const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (docWidth > width + 1) problems.push(`page scrolls sideways: ${docWidth}px at ${width}px`);
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
}
