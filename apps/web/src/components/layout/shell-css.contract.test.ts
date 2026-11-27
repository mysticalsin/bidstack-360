// Console-shell CSS contract (DESIGN.md 9.4): 64px / 232px rail, width eases
// with ease-ui-out in at most 250ms, instant under reduced motion or for a
// keyboard toggle, and below 56rem the sidebar is replaced by the drawer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing rule: ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

function mediaBlock(query: string): string {
  const start = css.indexOf(`@media ${query} {`);
  if (start < 0) throw new Error(`missing media block: ${query}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    if (depth === 0) return css.slice(start, i + 1);
  }
  return css.slice(start);
}

describe('console shell CSS', () => {
  it('rail is 232px expanded and 64px collapsed', () => {
    expect(block('.app-shell')).toContain('--sidebar-w: 232px');
    expect(css).toMatch(/\[data-sidebar-collapsed='true'\] \.app-shell \{[^}]*--sidebar-w: 64px/);
  });

  it('rail width eases with ease-ui-out in 250ms or less', () => {
    const shell = block('.app-shell');
    const match = shell.match(/transition:\s*grid-template-columns\s+(\d+)ms\s+var\(--ease-ui-out\)/);
    expect(match, shell).not.toBeNull();
    expect(Number(match?.[1])).toBeLessThanOrEqual(250);
  });

  it('rail width is instant for keyboard toggles and under reduced motion', () => {
    expect(css).toMatch(/\.app-shell:has\(> \.sidebar\[data-motion='instant'\]\) \{\s*transition: none;/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.app-shell,\s*\.mobile-nav-root,\s*\.mobile-nav-root \* \{\s*transition-duration: 0s !important;/,
    );
  });

  it('below 56rem the sidebar is hidden and the grid is one column', () => {
    const narrow = mediaBlock('(max-width: 55.99rem)');
    expect(narrow).toMatch(/\.app-shell \{\s*grid-template-columns: 1fr;/);
    expect(narrow).toMatch(/\.sidebar \{\s*display: none;/);
  });

  it('from 56rem the hamburger is hidden', () => {
    expect(mediaBlock('(min-width: 56rem)')).toMatch(/\.tb-nav-toggle \{\s*display: none;/);
  });

  it('drawer slides with ease-drawer and is instant when data-motion is instant', () => {
    expect(block('.mobile-nav-drawer')).toContain('var(--ease-drawer)');
    expect(css).toMatch(/\.mobile-nav-root\[data-motion='instant'\][^{]*\{\s*transition-duration: 0s !important;/);
  });

  it('drawer content clears the notch and the home indicator', () => {
    // index.html sets viewport-fit=cover, so these env() values are the real
    // status-bar, home-indicator, and landscape-notch bands. The panel stays
    // on the screen edge (a gap would show the page beside the scrim). The
    // content box is what has to move, or the close control and the last row
    // sit under the system chrome on a phone.
    const drawer = block('.mobile-nav-drawer');
    expect(drawer).toMatch(/top:\s*0/);
    expect(drawer).toMatch(/left:\s*0/);
    expect(drawer).toMatch(/bottom:\s*0/);
    expect(drawer).toContain('padding-top: env(safe-area-inset-top, 0px)');
    expect(drawer).toContain('padding-bottom: env(safe-area-inset-bottom, 0px)');
    expect(drawer).toContain('padding-left: env(safe-area-inset-left, 0px)');
  });
});
