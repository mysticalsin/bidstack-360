// Sourced figures layout contract (DESIGN.md 9.11): at 390, 768, 1024 and
// 1440 no figure, chip or registry row can push into its neighbour. Every
// box shrinks (min-width: 0), long text wraps or truncates with a title,
// and the grids collapse before a column gets too narrow to read.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
const figuresCss = read('components/figures/figures.css');
const knCss = read('components/positioning/positioning.css');
const enCss = read('components/enrichment/enrichment.css');
const ciCss = read('components/company-intel/company-intel.css');
const indexCss = read('index.css');

const WIDTHS = [390, 768, 1024, 1440] as const;
/** Below 56rem the rail becomes a drawer; above it the expanded rail takes 232px. */
const RAIL = (w: number) => (w >= 896 ? 232 : 0);
const PAGE_PADDING = 48;
const MIN_COLUMN = 120;

/** Every declaration body for `selector`, outside or inside media blocks. */
function rules(css: string, selector: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(^|[},\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*,[^{]*)?\\s*\\{([^}]*)\\}`, 'g');
  for (const m of css.matchAll(re)) out.push(m[3]!);
  return out;
}
const has = (css: string, selector: string, decl: RegExp) => rules(css, selector).some((r) => decl.test(r));

/** Column count of `.en-strip` at a viewport width, from its base rule and max-width media blocks. */
function enStripColumns(width: number): number {
  let cols = Number(/repeat\((\d+), minmax\(0, 1fr\)\)/.exec(rules(enCss, '.en-strip')[0]!)?.[1]);
  for (const m of enCss.matchAll(/@media \(max-width: (\d+)px\) \{\s*\.en-strip \{ grid-template-columns: ([^;]+);/g)) {
    if (width <= Number(m[1])) {
      const rep = /repeat\((\d+)/.exec(m[2]!);
      cols = Math.min(cols, rep ? Number(rep[1]) : m[2]!.trim() === '1fr' ? 1 : cols);
    }
  }
  return cols;
}

describe('sourced figures layout', () => {
  it('chips truncate on one line inside their box and keep the full text in a title', () => {
    const chip = rules(figuresCss, '.sf-chip').join(';');
    for (const decl of ['min-width: 0', 'max-width: 100%', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']) expect(chip).toContain(decl);
    const src = read('components/figures/SourcedFigure.tsx');
    expect(src.match(/className="sf-chip"[^>]*title=\{title\}/g)?.length).toBe(2);
  });

  it('every new container can shrink and long text wraps', () => {
    for (const sel of ['.sf-line', '.sf-empty', '.sf-form']) expect(has(figuresCss, sel, /min-width: 0/), sel).toBe(true);
    expect(has(figuresCss, '.sf-empty-text', /overflow-wrap: anywhere/)).toBe(true);
    expect(has(figuresCss, '.sf-form input', /min-width: 0/)).toBe(true);
    expect(has(figuresCss, '.sf-form select', /min-width: 0/)).toBe(true);
    expect(knCss).toMatch(/\.kn-tile, \.kn-label, \.kn-value, \.kn-sub, \.kn-prov \{ min-width: 0; \}/);
    expect(has(enCss, '.en-fact', /overflow-wrap: anywhere/)).toBe(true);
    for (const sel of ['.ci-registry-value', '.ci-registry-text', '.ci-registry-label']) expect(has(ciCss, sel, /min-width: 0/), sel).toBe(true);
  });

  it('key number tiles never force a column wider than the strip', () => {
    expect(knCss).toContain('grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr))');
    expect(knCss).toMatch(/\.kn-tile:has\(\.sf-form\) \.kn-tip/);
  });

  it.each(WIDTHS)('firmographics columns stay readable at %ipx', (w) => {
    const cols = enStripColumns(w);
    const content = w - RAIL(w) - PAGE_PADDING;
    expect(content / cols, `${cols} columns at ${w}px`).toBeGreaterThanOrEqual(MIN_COLUMN);
  });

  it('the firmographics strip collapses to two then one column', () => {
    expect(enStripColumns(1440)).toBe(4);
    expect(enStripColumns(768)).toBe(2);
    expect(enStripColumns(390)).toBe(1);
  });

  it('the command center footer truncates its figure and drops to one column on phones', () => {
    const strong = rules(indexCss, '.command-center-footer strong').join(';');
    expect(strong).toContain('text-overflow: ellipsis');
    expect(indexCss).toMatch(/@media \(max-width: 720px\) \{[\s\S]*?\.command-center-footer \{\s*grid-template-columns: 1fr;/);
    expect(has(figuresCss, '.command-center-footer .sf-chip', /text-transform: none/)).toBe(true);
  });

  it('tech stack buttons and fields meet the 44px touch target', () => {
    const src = read('components/company/CompanyTechStackSection.tsx');
    const btn = /const SECONDARY_BTN =\s*'([^']*)'/.exec(src)?.[1] ?? '';
    const input = /const INPUT =\s*'([^']*)'/.exec(src)?.[1] ?? '';
    expect(btn).toContain('min-h-11');
    expect(input).toContain('min-h-11');
    // The remove control on a chip is a button too.
    expect(src).toMatch(/aria-label=\{`Remove \$\{item\.name\}`\}\s*className="[^"]*min-h-11 min-w-11/);
    for (const m of src.matchAll(/<button[\s\S]*?className=\{?["'`]([^"'`]*)/g)) expect(m[1], m[1]).not.toMatch(/min-h-(6|8|9|10)\b/);
  });

  it('business snapshot rows wrap when the edit form opens', () => {
    expect(figuresCss).toMatch(/\.kvlist \.kv:has\(\.sf-form\) \{ flex-wrap: wrap; \}/);
    expect(has(indexCss, '.kv-value', /overflow-wrap: anywhere/)).toBe(true);
  });
});
