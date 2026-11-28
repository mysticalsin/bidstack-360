// A seller who has not set Mantu Academy credentials still sees fixture courses.
// The preview flag stays true. The words on the banner must call those courses
// reference records. Sample, demo, illustrative, and live tell the seller the
// product is a demo, so they are rejected in every CRM catalog and in the
// English fallback the page renders when a catalog key is missing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LOCALES = ['en', 'es', 'fr', 'it', 'pt', 'zh'] as const;

const BANNER_KEYS = ['sampleDataLabel', 'sampleDataIntro', 'sampleDataOutro'] as const;

/** Production copy. Key names stay sampleData* because the preview flag is unchanged. */
const EXPECTED: Record<(typeof LOCALES)[number], Record<(typeof BANNER_KEYS)[number], string>> = {
  en: {
    sampleDataLabel: 'Reference.',
    sampleDataIntro: 'These are reference records. Set',
    sampleDataOutro: '+ credentials to pull courses from Mantu Academy.',
  },
  es: {
    sampleDataLabel: 'Referencia.',
    sampleDataIntro: 'Estos son registros de referencia. Configura',
    sampleDataOutro: '+ credenciales para obtener cursos de Mantu Academy.',
  },
  fr: {
    sampleDataLabel: 'Référence.',
    sampleDataIntro: 'Ce sont des enregistrements de référence. Définissez',
    sampleDataOutro: '+ identifiants pour récupérer les cours depuis Mantu Academy.',
  },
  it: {
    sampleDataLabel: 'Riferimento.',
    sampleDataIntro: 'Questi sono record di riferimento. Imposta',
    sampleDataOutro: '+ credenziali per caricare i corsi da Mantu Academy.',
  },
  pt: {
    sampleDataLabel: 'Referência.',
    sampleDataIntro: 'Estes são registros de referência. Defina',
    sampleDataOutro: '+ credenciais para obter cursos da Mantu Academy.',
  },
  zh: {
    sampleDataLabel: '参考。',
    sampleDataIntro: '这些是参考记录。请设置',
    sampleDataOutro: '+ 凭据，以便从 Mantu Academy 获取课程。',
  },
};

const DEMO_COPY: Record<(typeof LOCALES)[number], RegExp> = {
  en: /sample|demo|illustrative|\blive\b/i,
  es: /ejemplo|ilustrativ|en vivo|demostraci|muestra/i,
  fr: /exemple|illustratif|en direct|démo|\bdemo\b/i,
  it: /esempio|illustrativ|tempo reale|dimostr/i,
  pt: /exemplo|ilustrativ|ao vivo|demonstr/i,
  zh: /示例|实时|演示/,
};

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function catalog(locale: (typeof LOCALES)[number]): Record<(typeof BANNER_KEYS)[number], string> {
  const json = JSON.parse(read(`public/locales/${locale}/crm.json`)) as {
    salesToolkits?: Record<string, string>;
  };
  const block = json.salesToolkits;
  if (!block) throw new Error(`${locale} crm catalog has no salesToolkits block`);
  return {
    sampleDataLabel: block.sampleDataLabel ?? '',
    sampleDataIntro: block.sampleDataIntro ?? '',
    sampleDataOutro: block.sampleDataOutro ?? '',
  };
}

function pageFallback(key: (typeof BANNER_KEYS)[number]): string {
  const src = read('src/pages/SalesToolkitsPage.tsx');
  const match = src.match(new RegExp(`salesToolkits\\.${key}', '([^']*)'`));
  if (!match?.[1]) throw new Error(`SalesToolkitsPage is missing the ${key} fallback`);
  return match[1];
}

describe('sales toolkit preview banner copy', () => {
  it('keeps the preview flag and the LMS credential path on the page', () => {
    const src = read('src/pages/SalesToolkitsPage.tsx');
    expect(src).toContain('toolkits.data?.preview');
    expect(src).toContain('LMS_360L_ENABLED');
    for (const key of BANNER_KEYS) expect(src).toContain(`salesToolkits.${key}`);
  });

  it('uses the English reference fallback on the banner', () => {
    for (const key of BANNER_KEYS) {
      expect(pageFallback(key)).toBe(EXPECTED.en[key]);
    }
    const joined = BANNER_KEYS.map((key) => pageFallback(key)).join(' ');
    expect(joined).not.toMatch(DEMO_COPY.en);
  });

  it.each(LOCALES)('%s catalog calls the preview courses reference records', (locale) => {
    const block = catalog(locale);
    expect(block).toEqual(EXPECTED[locale]);
    const joined = BANNER_KEYS.map((key) => block[key]).join(' ');
    expect(joined).toContain('Mantu Academy');
    expect(joined).not.toMatch(DEMO_COPY[locale]);
  });
});
