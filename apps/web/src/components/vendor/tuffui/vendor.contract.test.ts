// Vendored TUFFUI files must keep the MIT notice, list their rewrites, use
// lucide-react only, and carry no TUFFUI / shadcn vocabulary or literal
// geometry (DESIGN.md 9.1 and 9.3).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'src/components/vendor/tuffui');
const HEADER =
  '// TUFFUI (https://tuffui.com) \u00b7 MIT License \u00b7 Copyright (c) 2026 TUFFUI contributors';

const sources = readdirSync(DIR).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));

describe('vendored TUFFUI', () => {
  it('ships the full MIT license next to the sources', () => {
    const license = readFileSync(join(DIR, 'LICENSE'), 'utf8');
    expect(license).toContain('MIT License');
    expect(license).toContain('Copyright (c) 2026 TUFFUI contributors');
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });

  it('vendors at least StatusPill and Surface', () => {
    expect(sources).toEqual(expect.arrayContaining(['status-pill.tsx', 'surface.tsx']));
  });

  it.each(sources.map((f) => [f]))('%s keeps the header and lists rewrites', (file) => {
    const src = readFileSync(join(DIR, file), 'utf8');
    expect(src.startsWith(HEADER)).toBe(true);
    expect(src).toContain('378f3eaa');
    expect(src).toMatch(/Rewrites at import:/);
  });

  it('lib/motion-tokens.ts carries the same notice and rewrite list', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/motion-tokens.ts'), 'utf8');
    expect(src.startsWith(HEADER)).toBe(true);
    expect(src).toContain('378f3eaa');
    expect(src).toMatch(/Rewrites at import:/);
  });

  it.each(sources.map((f) => [f]))('%s has no foreign vocabulary or phosphor', (file) => {
    const src = readFileSync(join(DIR, file), 'utf8').split('\n').filter((l) => !l.startsWith('//')).join('\n');
    expect(src).not.toMatch(/@phosphor-icons/);
    expect(src).not.toMatch(/@\/lib\/utils/);
    expect(src).not.toMatch(/(muted-foreground|text-foreground|bg-foreground|bg-background)/);
    expect(src).not.toMatch(/["'\s]bg-surface["'\s]/);
    expect(src).not.toMatch(/rounded-\[(?!var\()/);
    expect(src).not.toMatch(/shadow-\[(?!var\()/);
  });
});
