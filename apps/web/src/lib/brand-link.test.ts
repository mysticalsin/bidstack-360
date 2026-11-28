// Why this test exists: a brand-colored link that underlines only on hover
// is identified by color alone (WCAG 1.4.1). One class carries the underline
// so the company link and the same pattern elsewhere stay in step.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { brandTextLinkClass } from './brand-link';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('brandTextLinkClass', () => {
  it('underlines the link without waiting for hover', () => {
    expect(brandTextLinkClass).toContain('underline');
    expect(brandTextLinkClass).not.toContain('hover:underline');
  });

  it('is the only copy of the brand-colored hover-underline link', () => {
    const pattern = 'text-[var(--brand-primary)] dark:text-[var(--brand-deep)] hover:underline';
    const hits: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      const text = readFileSync(file, 'utf8');
      if (text.includes(pattern)) hits.push(file.replace(process.cwd() + '/', ''));
    }
    expect(hits).toEqual([]);
  });
});
