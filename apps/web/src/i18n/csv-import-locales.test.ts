// WHY: the wizard's stall and failure copy is a key plus an English fallback.
// A locale file that omits the key shows that English sentence to every language.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = ['en', 'fr', 'es', 'pt', 'it', 'zh', 'ar'] as const;

function progress(locale: string): Record<string, string> {
  const raw = readFileSync(join(process.cwd(), 'public/locales', locale, 'crm.json'), 'utf8');
  const doc = JSON.parse(raw) as { csvImport?: { progress?: Record<string, string> } };
  return doc.csvImport?.progress ?? {};
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{[^}]+\}\}/g)].map((match) => match[0]).sort();
}

describe('csv import progress copy', () => {
  it('serves the Brazilian Portuguese Cancelling sentence for pt-BR', () => {
    // WHY: i18n load: 'languageOnly' maps pt-BR onto the pt catalog. The
    // wizard must keep using t() so that catalog is what a pt-BR browser reads.
    expect(progress('pt').cancelling).toBe('Cancelando…');
    expect(progress('pt').cancelling).not.toBe(progress('en').cancelling);
  });

  it('has every progress string in every locale', () => {
    const english = progress('en');
    const keys = Object.keys(english);
    expect(keys.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      const block = progress(locale);
      expect(Object.keys(block).sort(), locale).toEqual([...keys].sort());
      for (const key of keys) {
        expect(block[key], `${locale}.${key}`).toEqual(expect.any(String));
        expect(block[key]!.length, `${locale}.${key}`).toBeGreaterThan(0);
        if (locale !== 'en') expect(block[key], `${locale}.${key}`).not.toBe(english[key]);
        expect(placeholders(block[key]!), `${locale}.${key}`).toEqual(placeholders(english[key]!));
      }
    }
  });
});
