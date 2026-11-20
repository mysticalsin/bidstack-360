import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * Layout audit for the deals section (section-prefixed; a later PR dedupes the
 * per-section copies). Checks the settled page for:
 * - horizontal page overflow
 * - overlapping text boxes in the same stacking context
 * - clipped text without an ellipsis and a title
 * - text under 12px
 * - WCAG AA colour contrast (axe)
 */
export interface LayoutIssue {
  kind: 'overflow' | 'overlap' | 'clipped' | 'small-text' | 'contrast';
  detail: string;
}

export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'phone', width: 390, height: 844 },
] as const;

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Persist the theme before any app script runs (index.html reads it pre-paint). */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('bidstack-theme', t);
    } catch {
      /* storage blocked */
    }
  }, theme);
}

/** Wait until skeletons are gone and no animation is mid-flight. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('[aria-busy="true"], .animate-pulse').length === 0 &&
        document.getAnimations().every((a) => a.playState !== 'running'),
      null,
      { timeout: 8_000 },
    )
    .catch(() => undefined);
}

export async function auditLayout(page: Page): Promise<LayoutIssue[]> {
  const issues: LayoutIssue[] = await page.evaluate(() => {
    const out: Array<{ kind: 'overflow' | 'overlap' | 'clipped' | 'small-text'; detail: string }> =
      [];
    const root = document.scrollingElement ?? document.documentElement;
    if (root.scrollWidth > window.innerWidth + 1) {
      out.push({
        kind: 'overflow',
        detail: `page scrollWidth ${root.scrollWidth} > viewport ${window.innerWidth}`,
      });
    }

    const label = (el: Element) => {
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const testId = el.getAttribute('data-testid');
      return `<${el.tagName.toLowerCase()}${testId ? ` data-testid=${testId}` : ''}> "${text}"`;
    };

    const isVisible = (el: Element) => {
      if (el.closest('[aria-hidden="true"], .sr-only, [hidden], svg, canvas')) return false;
      const style = getComputedStyle(el);
      if (
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // Elements that own visible text directly (a non-blank text node child).
    const textEls: HTMLElement[] = [];
    // The app shell (sidebar, top bar) is audited with its own section.
    const scope = document.querySelector('main') ?? document.body;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n as HTMLElement;
      const ownsText = Array.from(el.childNodes).some(
        (c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim().length > 0,
      );
      if (ownsText && isVisible(el)) textEls.push(el);
    }

    for (const el of textEls) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) out.push({ kind: 'small-text', detail: `${size}px ${label(el)}` });

      const style = getComputedStyle(el);
      const clipsX =
        el.scrollWidth > el.clientWidth + 1 &&
        (style.overflowX === 'hidden' || style.overflowX === 'clip');
      if (clipsX) {
        const ellipsis = style.textOverflow === 'ellipsis';
        const titled = Boolean(
          el.getAttribute('title') ||
          el.closest('[title]') ||
          el.getAttribute('aria-label') ||
          el.closest('[aria-label]'),
        );
        if (!ellipsis || !titled) {
          out.push({
            kind: 'clipped',
            detail: `${ellipsis ? 'ellipsis without title' : 'hard clip'} ${label(el)}`,
          });
        }
      }
    }

    // Stacking context root: nearest positioned ancestor with a z-index, or a
    // fixed/sticky one. Only text in the same context can collide visibly.
    const contextOf = (el: Element): Element => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.position === 'fixed' || s.position === 'sticky') return p;
        if (s.position !== 'static' && s.zIndex !== 'auto') return p;
        if (s.transform !== 'none' || Number(s.opacity) < 1) return p;
      }
      return document.documentElement;
    };

    // Range client rects hug the glyphs line by line, so padding, line boxes
    // and the empty corners of wrapped inline text do not count.
    const glyphRects = (el: HTMLElement): DOMRect[] => {
      const textNodes = Array.from(el.childNodes).filter(
        (c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim().length > 0,
      );
      if (textNodes.length === 0) return [];
      const range = document.createRange();
      range.setStartBefore(textNodes[0]!);
      range.setEndAfter(textNodes[textNodes.length - 1]!);
      const clips: DOMRect[] = [];
      // Ellipsis cells and scrollers paint only inside their box.
      for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
        const c = p.getBoundingClientRect();
        clips.push(
          new DOMRect(
            st.overflowX === 'visible' ? -Infinity : c.left,
            st.overflowY === 'visible' ? -Infinity : c.top,
            st.overflowX === 'visible' ? Infinity : c.width,
            st.overflowY === 'visible' ? Infinity : c.height,
          ),
        );
      }
      return Array.from(range.getClientRects()).flatMap((r) => {
        let { left, top, right, bottom } = r;
        for (const c of clips) {
          left = Math.max(left, c.left);
          top = Math.max(top, c.top);
          right = Math.min(right, c.left + c.width);
          bottom = Math.min(bottom, c.top + c.height);
        }
        return right - left > 0 && bottom - top > 0
          ? [new DOMRect(left, top, right - left, bottom - top)]
          : [];
      });
    };

    const boxes = textEls
      .map((el) => ({ el, rects: glyphRects(el), ctx: contextOf(el) }))
      .filter((b) => b.rects.length > 0);
    const collide = (a: DOMRect, b: DOMRect) => {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      // Two px of slack absorbs tight line-height and descender overlap.
      return w > 2 && h > 2;
    };
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.ctx !== b.ctx) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        if (a.rects.some((ra) => b.rects.some((rb) => collide(ra, rb)))) {
          out.push({ kind: 'overlap', detail: `${label(a.el)} overlaps ${label(b.el)}` });
        }
      }
    }
    return out;
  });

  const axe = await new AxeBuilder({ page })
    .include('main')
    .withRules(['color-contrast'])
    .analyze();
  for (const v of axe.violations) {
    for (const node of v.nodes) {
      issues.push({
        kind: 'contrast',
        detail: `${node.target.join(' ')} ${node.failureSummary?.split('\n').at(-1)?.trim() ?? ''}`,
      });
    }
  }
  return dedupe(issues);
}

function dedupe(issues: LayoutIssue[]): LayoutIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.kind}|${i.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
