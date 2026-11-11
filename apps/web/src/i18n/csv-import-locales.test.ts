// WHY: the wizard's stall and failure copy is a key plus an English fallback.
// A locale file that omits the key shows that English sentence to every language.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = ['en', 'fr', 'es', 'pt', 'it', 'zh', 'ar'] as const;

const KEYS = [
  'statusStalled',
  'reasonStalled',
  'reasonEnqueue',
  'reasonRowsExpired',
  'reasonUnknown',
  'actionFailed',
] as const;

function progress(locale: string): Record<string, string> {
  const raw = readFileSync(join(process.cwd(), 'public/locales', locale, 'crm.json'), 'utf8');
  const doc = JSON.parse(raw) as { csvImport?: { progress?: Record<string, string> } };
  return doc.csvImport?.progress ?? {};
}

describe('csv import progress copy', () => {
  it('has the stall and failure strings in every locale', () => {
    const english = progress('en');
    for (const locale of LOCALES) {
      const block = progress(locale);
      for (const key of KEYS) {
        expect(block[key], `${locale}.${key}`).toEqual(expect.any(String));
        expect(block[key]!.length, `${locale}.${key}`).toBeGreaterThan(0);
        if (locale !== 'en') expect(block[key], `${locale}.${key}`).not.toBe(english[key]);
      }
    }
  });
});
