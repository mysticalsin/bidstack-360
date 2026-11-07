/**
 * Layout audit helpers for the proposals section review.
 *
 * Section-prefixed on purpose: each review swarm section ships its own copy so
 * parallel PRs do not conflict. A later PR dedupes them.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export type Theme = 'light' | 'dark';

export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'phone', width: 390, height: 844 },
] as const;

export const THEMES: readonly Theme[] = ['light', 'dark'];

export interface LayoutIssue {
  kind: 'overflow' | 'overlap' | 'clipped' | 'tiny-text' | 'contrast';
  detail: string;
}

/** Seeds the persisted theme before any app script runs. */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('bidstack-theme', t);
    } catch {
      /* storage blocked */
    }
    document.documentElement.dataset.theme = t;
  }, theme);
}

/** Waits until entry animations and pending fonts settle so geometry is stable. */
export async function settle(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => document.getAnimations().every((a) => a.playState !== 'running'),
      null,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
}

/**
 * Geometry checks run in the page: horizontal page overflow, overlapping text
 * leaves, clipped text without an ellipsis and title, and text under 12px.
 */
export async function geometryIssues(page: Page): Promise<LayoutIssue[]> {
  return page.evaluate(() => {
    const issues: { kind: 'overflow' | 'overlap' | 'clipped' | 'tiny-text'; detail: string }[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) {
      issues.push({
        kind: 'overflow',
        detail: `page scrollWidth ${doc.scrollWidth} > viewport ${window.innerWidth}`,
      });
    }

    const label = (el: Element) => {
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const testId = el.getAttribute('data-testid');
      return `${el.tagName.toLowerCase()}${testId ? `[${testId}]` : ''} "${text}"`;
    };

    const isVisible = (el: Element) => {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)
        return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const insideHidden = (el: Element) =>
      el.closest('[aria-hidden="true"], .sr-only, [data-sr-only], svg, [hidden]') !== null;

    // Leaf text elements: they own a non-empty direct text node.
    const leaves: Element[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || seen.has(parent)) continue;
      if (!(n.textContent ?? '').trim()) continue;
      seen.add(parent);
      if (insideHidden(parent) || !isVisible(parent)) continue;
      leaves.push(parent);
    }

    const inViewport = (r: DOMRect) =>
      r.bottom > 0 && r.right > 0 && r.top < window.innerHeight * 3 && r.left < window.innerWidth;

    for (const el of leaves) {
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      if (size < 12 && !el.closest('[data-audit-allow-small]')) {
        issues.push({ kind: 'tiny-text', detail: `${label(el)} is ${size}px` });
      }
      const clips =
        (style.overflowX === 'hidden' || style.overflow === 'hidden') &&
        el.scrollWidth > el.clientWidth + 1 &&
        style.whiteSpace === 'nowrap';
      if (clips) {
        const ellipsis = style.textOverflow === 'ellipsis';
        const titled = Boolean(el.getAttribute('title') || el.closest('[title]'));
        if (!ellipsis || !titled) {
          issues.push({
            kind: 'clipped',
            detail: `${label(el)} clipped (ellipsis=${ellipsis}, title=${titled})`,
          });
        }
      }
    }

    // Overlap: compare leaves that share a stacking ancestor (same fixed or
    // positioned layer). Cap the work so huge tables stay fast.
    const layerOf = (el: Element): Element => {
      let cur: Element | null = el.parentElement;
      while (cur && cur !== document.body) {
        const s = getComputedStyle(cur);
        if (s.position === 'fixed' || s.position === 'sticky') return cur;
        if (s.zIndex !== 'auto' && s.position !== 'static') return cur;
        cur = cur.parentElement;
      }
      return document.body;
    };
    const boxes = leaves
      .slice(0, 600)
      .map((el) => ({ el, r: el.getBoundingClientRect(), layer: layerOf(el) }))
      .filter((b) => inViewport(b.r));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.layer !== b.layer) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (x > 2 && y > 2) {
          issues.push({ kind: 'overlap', detail: `${label(a.el)} overlaps ${label(b.el)}` });
        }
      }
    }
    return issues;
  });
}

/** axe color-contrast (WCAG AA) violations on the settled page. */
export async function contrastIssues(page: Page): Promise<LayoutIssue[]> {
  const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  return result.violations.flatMap((v) =>
    v.nodes.map((n) => ({ kind: 'contrast' as const, detail: `${n.target.join(' ')}` })),
  );
}

export async function layoutIssues(page: Page): Promise<LayoutIssue[]> {
  await settle(page);
  return [...(await geometryIssues(page)), ...(await contrastIssues(page))];
}
