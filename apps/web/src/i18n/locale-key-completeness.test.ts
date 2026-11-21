// Why this test exists: a key present in English and missing in French,
// Spanish, Italian, or Arabic falls back to English beside translated
// neighbours. The rail and navigation keys are required in fr, es, and it.
// Everything else still missing is listed in locale-gaps.allow.json so a
// new gap fails CI.
//
// Arabic stays a supported locale. The `ar` list in locale-gaps.allow.json
// is empty: every English key has an Arabic string. A new gap fails CI.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LOCALES = ['fr', 'es', 'it', 'ar'] as const;
const RAIL_LOCALES = ['fr', 'es', 'it'] as const;
const RAIL_KEYS = [
  'common:nav.agreements',
  'common:nav.meetings',
  'common:breadcrumbs.agreements',
  'common:breadcrumbs.meetings',
];

const ROOT = join(process.cwd(), 'public/locales');
const ALLOW_PATH = join(process.cwd(), 'src/i18n/locale-gaps.allow.json');

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
  const raw = readFileSync(join(ROOT, locale, `${namespace}.json`), 'utf8');
  return new Set(flatten(JSON.parse(raw) as unknown));
}

function namespaces(): string[] {
  return readdirSync(join(ROOT, 'en'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function missingKeys(locale: (typeof LOCALES)[number]): string[] {
  const missing: string[] = [];
  for (const namespace of namespaces()) {
    const english = keys('en', namespace);
    const catalog = keys(locale, namespace);
    for (const key of english) {
      if (!catalog.has(key)) missing.push(`${namespace}:${key}`);
    }
  }
  return missing.sort();
}

describe('fr, es, it, and ar catalogs', () => {
  const allow = JSON.parse(readFileSync(ALLOW_PATH, 'utf8')) as {
    fr: string[];
    es: string[];
    it: string[];
    ar: string[];
  };

  it('include the rail and navigation keys in fr, es, and it', () => {
    const missing = RAIL_LOCALES.flatMap((locale) =>
      RAIL_KEYS.filter((key) => missingKeys(locale).includes(key)).map((key) => `${locale}:${key}`),
    );
    expect(missing).toEqual([]);
  });

  it('has no English key missing outside the documented remainder', () => {
    const unexpected: string[] = [];
    const stale: string[] = [];
    for (const locale of LOCALES) {
      const missing = new Set(missingKeys(locale));
      const allowed = new Set(allow[locale]);
      for (const key of missing) {
        if (!allowed.has(key)) unexpected.push(`${locale}:${key}`);
      }
      for (const key of allowed) {
        if (!missing.has(key)) stale.push(`${locale}:${key}`);
      }
      if ((RAIL_LOCALES as readonly string[]).includes(locale)) {
        for (const key of RAIL_KEYS) {
          expect(allowed.has(key), `${locale} allowlist must not excuse ${key}`).toBe(false);
        }
      }
    }
    expect(unexpected).toEqual([]);
    expect(stale).toEqual([]);
  });
});
