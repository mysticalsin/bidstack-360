// Layout audit helpers for the comms section (calendar, calls, meetings,
// public booking, integrations, email). Section-prefixed so parallel review
// PRs do not collide; a later PR dedupes the per-section copies.

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export type LayoutIssue = { kind: string; detail: string };

const ROOT_SELECTOR = 'main';

export const AUDIT_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'phone', width: 390, height: 844 },
] as const;

export const AUDIT_THEMES = ['light', 'dark'] as const;
export type AuditTheme = (typeof AUDIT_THEMES)[number];

/** Pin the theme before any app script runs, the same way the theme store reads it. */
export async function pinTheme(page: Page, theme: AuditTheme): Promise<void> {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('bidstack-theme', t);
    } catch {
      /* storage unavailable */
    }
    document.documentElement.dataset.theme = t;
  }, theme);
}

/** Wait until data has landed and entry animations are done. */
export async function settle(page: Page): Promise<void> {
  await page.getByRole('main').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page
    .waitForFunction(
      () =>
        !document.querySelector('[aria-busy="true"], .skeleton, [data-skeleton]') &&
        document.getAnimations().every((a) => a.playState !== 'running'),
      null,
      { timeout: 8_000 },
    )
    .catch(() => undefined);
}

/**
 * Geometry checks inside `main`: horizontal page overflow, text under 12px,
 * overlapping text runs in the same stacking context, and clipped text that
 * has neither an ellipsis nor a title to recover the full value.
 */
export async function geometryIssues(page: Page, rootSelector = ROOT_SELECTOR): Promise<LayoutIssue[]> {
  return page.evaluate((sel) => {
    const issues: { kind: string; detail: string }[] = [];
    const root = document.querySelector(sel) ?? document.querySelector('main') ?? document.body;
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      issues.push({
        kind: 'page-overflow-x',
        detail: `scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth}`,
      });
    }

    const label = (el: Element): string => {
      const id = el.id ? `#${el.id}` : '';
      const cls =
        typeof el.className === 'string' && el.className
          ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
          : '';
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${id}${cls} "${text}"`;
    };

    const isVisible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
        return false;
      }
      if (el.closest('[aria-hidden="true"], .sr-only, [hidden]')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // A clipped ancestor (e.g. a scrollable table wrapper) hides off-screen text
    // legitimately; only measure text that is actually painted in the viewport.
    const stackingRoot = (el: Element): Element => {
      let node: Element | null = el.parentElement;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        if (
          s.position === 'fixed' ||
          s.position === 'sticky' ||
          (s.position !== 'static' && s.zIndex !== 'auto') ||
          Number(s.opacity) < 1 ||
          s.transform !== 'none'
        ) {
          return node;
        }
        node = node.parentElement;
      }
      return document.body;
    };

    type Run = { el: Element; rect: DOMRect; group: Element };
    const runs: Run[] = [];
    const small = new Set<string>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? '';
      if (!text.trim()) continue;
      const el = n.parentElement;
      if (!el || !isVisible(el)) continue;
      if (el.closest('svg, script, style, noscript, option')) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) small.add(`${label(el)} ${size}px`);
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 2 || rect.height < 2) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        runs.push({ el, rect, group: stackingRoot(el) });
      }
    }
    for (const s of small) issues.push({ kind: 'text-under-12px', detail: s });

    for (let i = 0; i < runs.length; i += 1) {
      const a = runs[i]!;
      for (let j = i + 1; j < runs.length; j += 1) {
        const b = runs[j]!;
        if (a.el === b.el || a.group !== b.group) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const h = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (w <= 1 || h <= 1) continue;
        const smaller = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
        if ((w * h) / smaller < 0.2) continue;
        issues.push({ kind: 'text-overlap', detail: `${label(a.el)} overlaps ${label(b.el)}` });
      }
    }

    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (!isVisible(el) || el.children.length > 0) continue;
      if (!(el.textContent ?? '').trim()) continue;
      const s = getComputedStyle(el);
      const clipsX = s.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1;
      const clamped = s.webkitLineClamp !== 'none' && s.webkitLineClamp !== '' && el.scrollHeight > el.clientHeight + 1;
      if (!clipsX && !clamped) continue;
      if (el.matches('input, textarea, select')) continue;
      const titled = Boolean(el.closest('[title]')) || Boolean(el.closest('[aria-label]'));
      const ellipsis = s.textOverflow === 'ellipsis' || clamped;
      if (!(ellipsis && titled)) {
        issues.push({
          kind: 'clipped-text',
          detail: `${label(el)} ellipsis=${ellipsis} title=${titled}`,
        });
      }
    }
    return issues;
  }, rootSelector);
}

/** Colour contrast (WCAG AA) inside main via axe. */
export async function contrastIssues(page: Page, rootSelector = ROOT_SELECTOR): Promise<LayoutIssue[]> {
  const scoped = (await page.locator(rootSelector).count()) > 0;
  const results = await new AxeBuilder({ page })
    .include(scoped ? rootSelector : 'body')
    .withRules(['color-contrast'])
    .analyze();
  return results.violations.flatMap((v) =>
    v.nodes.map((n) => ({
      kind: 'contrast',
      detail: `${JSON.stringify(n.target)} ${n.any[0]?.message ?? v.help}`,
    })),
  );
}

export function formatIssues(route: string, issues: LayoutIssue[]): string {
  return [`${issues.length} layout issue(s) on ${route}:`, ...issues.map((i) => `  [${i.kind}] ${i.detail}`)].join('\n');
}
