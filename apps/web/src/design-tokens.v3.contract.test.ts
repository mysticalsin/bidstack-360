// Contract for the DESIGN.md v3.0.0 token additions (sections 9.1 and 9.2).
// Values must exist in BOTH theme blocks, and the @theme bridge must expose
// them as utilities, otherwise a vendored component renders unstyled in one
// theme. happy-dom does not resolve CSS variables, so this pins the source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

function block(selectorStart: string): string {
  const start = css.indexOf(selectorStart);
  expect(start, `missing block ${selectorStart}`).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated block ${selectorStart}`);
}

const light = block(":root,\n[data-theme='light']");
const dark = block("[data-theme='dark'] {");
const theme = block('@theme {');

describe('v3 surface tokens', () => {
  it('defines shell and inset surfaces in light', () => {
    expect(light).toMatch(/--surface-shell:\s*#f0f0f0;/);
    expect(light).toMatch(/--surface-inset:\s*#ffffff;/);
  });

  it('defines shell and inset surfaces in dark', () => {
    expect(dark).toMatch(/--surface-shell:\s*#121214;/);
    expect(dark).toMatch(/--surface-inset:\s*#0c0c0e;/);
  });

  it('bridges the new surfaces into utilities', () => {
    expect(theme).toMatch(/--color-surface-shell:\s*var\(--surface-shell\);/);
    expect(theme).toMatch(/--color-surface-inset:\s*var\(--surface-inset\);/);
  });

  it('maps positive / negative / warning onto the existing status vars', () => {
    expect(theme).toMatch(/--color-positive:\s*var\(--success\);/);
    expect(theme).toMatch(/--color-positive-tint:\s*var\(--success-tint\);/);
    expect(theme).toMatch(/--color-negative:\s*var\(--danger\);/);
    expect(theme).toMatch(/--color-negative-tint:\s*var\(--danger-tint\);/);
    expect(theme).toMatch(/--color-warning:\s*var\(--warning\);/);
  });
});

describe('v3 motion tokens', () => {
  it('exposes the three UI easing curves as Tailwind ease utilities', () => {
    expect(theme).toMatch(/--ease-ui-out:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\);/);
    expect(theme).toMatch(/--ease-ui-in-out:\s*cubic-bezier\(0\.77, 0, 0\.175, 1\);/);
    expect(theme).toMatch(/--ease-drawer:\s*cubic-bezier\(0\.32, 0\.72, 0, 1\);/);
  });

  it('keeps the existing duration tokens the motion table maps onto', () => {
    expect(css).toMatch(/--duration-enter:\s*210ms/);
    expect(css).toMatch(/--duration-exit:\s*150ms/);
    expect(css).toMatch(/--duration-move:\s*400ms/);
  });
});
