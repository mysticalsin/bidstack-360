// Layout audit helpers for the technology stack (slice 16): the account page
// wall, the cockpit Technical Stack card and the accounts list card logos.
// Section-prefixed so parallel review PRs do not collide; a later PR dedupes
// the per-section copies. Theme, viewport and settle helpers are shared with
// the accounts section.

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export { AUDIT_THEMES, AUDIT_VIEWPORTS, formatIssues, pinTheme, settle, type AuditTheme, type LayoutIssue } from './accounts-layout.js';
import type { LayoutIssue } from './accounts-layout.js';

/** Every tech stack surface the slice owns. */
export const TECH_REGIONS = [
  '[data-testid="tech-stack-wall"]',
  '[data-testid="tech-coverage-line"]',
  '[data-testid="account-card-tech"]',
  'section[aria-label="Technical Stack Overview"], [role="region"][aria-label="Technical Stack Overview"]',
] as const;

/**
 * Geometry checks inside the tech regions: horizontal page overflow, text
 * under 12px, overlapping text runs in the same stacking context, and clipped
 * text with neither an ellipsis nor a title.
 */
export async function techGeometryIssues(page: Page): Promise<LayoutIssue[]> {
  return page.evaluate((selectors) => {
    const issues: { kind: string; detail: string }[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      issues.push({ kind: 'page-overflow-x', detail: `scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth}` });
    }
    const roots = selectors.flatMap((s) => Array.from(document.querySelectorAll<HTMLElement>(s)));
    const label = (el: Element): string => {
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${cls} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
    };
    const isVisible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      if (el.closest('[aria-hidden="true"], .sr-only, [hidden]')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const stackingRoot = (el: Element): Element => {
      let node: Element | null = el.parentElement;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        if (s.position === 'fixed' || s.position === 'sticky' || (s.position !== 'static' && s.zIndex !== 'auto') || Number(s.opacity) < 1 || s.transform !== 'none') {
          return node;
        }
        node = node.parentElement;
      }
      return document.body;
    };
    type Run = { el: Element; rect: DOMRect; group: Element };
    const seenSmall = new Set<string>();
    for (const root of roots) {
      // The cockpit card's older source badges sit under the accounts small-text ratchet;
      // only the surfaces this slice added are held to the hard 12px floor.
      const strictSmall = !root.matches('[aria-label="Technical Stack Overview"]');
      const runs: Run[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!(n.textContent ?? '').trim()) continue;
        const el = n.parentElement;
        if (!el || !isVisible(el) || el.closest('svg, script, style, option')) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 12 && (strictSmall || el.closest('[data-testid="tech-coverage-line"]'))) seenSmall.add(`${label(el)} ${size}px`);
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
          runs.push({ el, rect, group: stackingRoot(el) });
        }
      }
      for (let i = 0; i < runs.length; i += 1) {
        const a = runs[i]!;
        for (let j = i + 1; j < runs.length; j += 1) {
          const b = runs[j]!;
          if (a.el === b.el || a.group !== b.group || a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const h = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          if (w <= 1 || h <= 1) continue;
          const smaller = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
          if ((w * h) / smaller < 0.2) continue;
          issues.push({ kind: 'text-overlap', detail: `${label(a.el)} overlaps ${label(b.el)}` });
        }
      }
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (!isVisible(el) || el.children.length > 0 || !(el.textContent ?? '').trim()) continue;
        const s = getComputedStyle(el);
        if (!(s.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1)) continue;
        const titled = Boolean(el.closest('[title]')) || Boolean(el.closest('[aria-label]'));
        if (!(s.textOverflow === 'ellipsis' && titled)) {
          issues.push({ kind: 'clipped-text', detail: `${label(el)} ellipsis=${s.textOverflow === 'ellipsis'} title=${titled}` });
        }
      }
    }
    for (const s of seenSmall) issues.push({ kind: 'text-under-12px', detail: s });
    return issues;
  }, [...TECH_REGIONS]);
}

/** WCAG AA colour contrast inside the tech regions that are on the page. */
export async function techContrastIssues(page: Page): Promise<LayoutIssue[]> {
  const present: string[] = [];
  for (const s of TECH_REGIONS) if ((await page.locator(s).count()) > 0) present.push(s);
  if (present.length === 0) return [];
  let builder = new AxeBuilder({ page }).withRules(['color-contrast']);
  for (const s of present) builder = builder.include(s);
  const results = await builder.analyze();
  return results.violations.flatMap((v) =>
    v.nodes.map((n) => ({ kind: 'contrast', detail: `${JSON.stringify(n.target)} ${n.any[0]?.message ?? v.help}` })),
  );
}
