// Why this test exists: Arabic is a supported locale. A key present in
// English and missing from ar falls back to English beside translated
// neighbours. The gate fails until every English key exists in ar.
//
// Arabic plurals use six CLDR categories (zero, one, two, few, many, other).
// i18next selects them with the _category suffix. An English one/other pair
// is not enough: counts 0, 2, 3, and 11 would hit the wrong form.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'public/locales');
const AR_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (node: unknown, path: string) => {
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        visit(child, path ? `${path}.${key}` : key);
      }
      return;
    }
    if (path) out.set(path, typeof node === 'string' ? node : JSON.stringify(node));
  };
  visit(value, prefix);
  return out;
}

function catalog(locale: string, namespace: string): Map<string, string> {
  const raw = readFileSync(join(ROOT, locale, `${namespace}.json`), 'utf8');
  return flatten(JSON.parse(raw) as unknown);
}

function namespaces(): string[] {
  return readdirSync(join(ROOT, 'en'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function placeholders(value: string): string[] {
  return value.match(/\{\{[^}]+\}\}/g) ?? [];
}

describe('Arabic catalogs', () => {
  it('include every English key, with the same placeholders', () => {
    const missing: string[] = [];
    const blank: string[] = [];
    const placeholderDrift: string[] = [];

    for (const namespace of namespaces()) {
      const english = catalog('en', namespace);
      const arabic = catalog('ar', namespace);
      for (const [key, source] of english) {
        const id = `${namespace}:${key}`;
        if (!arabic.has(key)) {
          missing.push(id);
          continue;
        }
        const translated = arabic.get(key) ?? '';
        if (source.trim() !== '' && translated.trim() === '') blank.push(id);
        const sourceTokens = placeholders(source);
        if (sourceTokens.some((token) => !translated.includes(token))) {
          placeholderDrift.push(id);
        }
      }
    }

    expect(missing, 'English keys missing from ar').toEqual([]);
    expect(blank, 'Arabic values left blank').toEqual([]);
    expect(placeholderDrift, 'placeholders dropped or renamed').toEqual([]);
  });

  it('gives every plural stem the Arabic categories zero, one, two, few, many, and other', () => {
    const incomplete: string[] = [];

    for (const namespace of namespaces()) {
      const english = catalog('en', namespace);
      const arabic = catalog('ar', namespace);
      const stems = new Set<string>();
      for (const key of english.keys()) {
        const match = PLURAL_SUFFIX.exec(key);
        if (match) stems.add(key.slice(0, -match[0].length));
      }
      for (const stem of stems) {
        const absent = AR_CATEGORIES.filter((category) => !arabic.has(`${stem}_${category}`));
        if (absent.length > 0) incomplete.push(`${namespace}:${stem} missing ${absent.join(', ')}`);
      }
    }

    expect(incomplete).toEqual([]);
  });
});
