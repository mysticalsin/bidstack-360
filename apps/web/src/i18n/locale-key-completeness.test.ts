// Why this test exists: the rail calls t(labelKey, englishFallback). A missing
// catalog key does not show the raw key. It shows the English fallback beside
// translated neighbours, so French, Spanish, and Italian render "Agreements"
// and "Meetings" while the rest of the rail is translated.
//
// Arabic is a supported locale whose catalogs are intentionally incomplete
// and whose switcher is hidden until RTL is reviewed. This test covers the
// locales the switcher actually offers.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DISPLAY_LOCALES = ['fr', 'es', 'pt', 'it', 'zh'] as const;
const ROOT = join(process.cwd(), 'public/locales');

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return flatten(child, next);
  });
}

function keys(locale: string, namespace: string): Set<string> {
  const raw = readFileSync(join(ROOT, locale, namespace), 'utf8');
  return new Set(flatten(JSON.parse(raw) as unknown));
}

describe('display-locale catalogs', () => {
  it('include every English common.json key', () => {
    const english = keys('en', 'common.json');
    const missing: string[] = [];
    for (const locale of DISPLAY_LOCALES) {
      const catalog = keys(locale, 'common.json');
      for (const key of english) {
        if (!catalog.has(key)) missing.push(`${locale}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
