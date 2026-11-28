// WHY: the map step names the first-row column with a key plus an English
// fallback. A catalog that still says Sample (or esempio, exemple, ejemplo,
// amostra, 示例) shows that word to the seller. The key stays colSample.
// Arabic has no map block, so it uses the fallback. The predictive admin
// Samples column is a different key and stays.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const COLUMN_HEADER: Record<string, string> = {
  en: 'Reference',
  es: 'Referencia',
  fr: 'Référence',
  it: 'Riferimento',
  pt: 'Referência',
  zh: '参考',
};

const DEMO_HEADER: Record<string, string> = {
  en: 'Sample',
  es: 'Muestra',
  fr: 'Exemple',
  it: 'Esempio',
  pt: 'Amostra',
  zh: '示例',
};

const PREDICTIVE_SAMPLES: Record<string, string> = {
  en: 'Samples',
  es: 'Muestras',
  fr: 'Échantillons',
  it: 'Campioni',
  pt: 'Amostras',
  zh: '样本',
};

function crm(locale: string): {
  csvImport?: { map?: Record<string, string> };
  predictiveAdmin?: { colSamples?: string };
} {
  const raw = readFileSync(join(process.cwd(), 'public/locales', locale, 'crm.json'), 'utf8');
  return JSON.parse(raw) as {
    csvImport?: { map?: Record<string, string> };
    predictiveAdmin?: { colSamples?: string };
  };
}

describe('csv import map column header copy', () => {
  it('names csvImport.map.colSample Reference in every catalog that has the column', () => {
    for (const [locale, expected] of Object.entries(COLUMN_HEADER)) {
      const doc = crm(locale);
      const header = doc.csvImport?.map?.colSample;
      expect(header, locale).toBe(expected);
      expect(header, locale).not.toBe(DEMO_HEADER[locale]);
      expect(doc.csvImport?.map?.colCsvColumn, locale).not.toBe(expected);
      expect(doc.predictiveAdmin?.colSamples, locale).toBe(PREDICTIVE_SAMPLES[locale]);
    }
  });

  it('keeps the English fallback on csvImport.map.colSample as Reference', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/import/CsvImportWizard.tsx'),
      'utf8',
    );
    expect(source).toContain("t('csvImport.map.colSample', 'Reference')");
    expect(source).not.toContain("t('csvImport.map.colSample', 'Sample')");
  });
});
