// A seller who has not set InfoSearch credentials still sees fixture leads.
// The preview flag stays true. The caption must call those rows reference
// records. Sample, demo, and live tell the seller the product is a demo or a
// live pull, so they are rejected in every CRM catalog and in the English
// fallback the card renders when a catalog key is missing. The connected
// caption is the same rule: nothing on the card is marked live.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LOCALES = ['en', 'es', 'fr', 'it', 'pt', 'zh'] as const;

const CAPTION_KEYS = ['captionPreview', 'captionLive'] as const;

/** Production copy. The preview flag and INFOSEARCH_ENABLED path stay. */
const EXPECTED: Record<(typeof LOCALES)[number], Record<(typeof CAPTION_KEYS)[number], string>> = {
  en: {
    captionPreview: 'Reference records — connect InfoSearch (INFOSEARCH_ENABLED) for call lists',
    captionLive: 'Call lists and lead intel for this account — pulled from InfoSearch',
  },
  es: {
    captionPreview:
      'Registros de referencia — conecta InfoSearch (INFOSEARCH_ENABLED) para listas de llamadas',
    captionLive:
      'Listas de llamadas e inteligencia de leads para esta cuenta — obtenidas de InfoSearch',
  },
  fr: {
    captionPreview:
      "Enregistrements de référence — connectez InfoSearch (INFOSEARCH_ENABLED) pour des listes d'appels",
    captionLive:
      "Listes d'appels et renseignements sur les leads pour ce compte — récupérés depuis InfoSearch",
  },
  it: {
    captionPreview:
      'Record di riferimento — collega InfoSearch (INFOSEARCH_ENABLED) per elenchi di chiamate',
    captionLive:
      'Elenchi di chiamate e intelligence sui lead per questo account — estratti da InfoSearch',
  },
  pt: {
    captionPreview:
      'Registros de referência — conecte o InfoSearch (INFOSEARCH_ENABLED) para listas de chamadas',
    captionLive:
      'Listas de chamadas e inteligência de leads para esta conta — obtidas do InfoSearch',
  },
  zh: {
    captionPreview: '参考记录 — 连接 InfoSearch (INFOSEARCH_ENABLED) 以获取通话名单',
    captionLive: '此客户的通话名单和潜在客户情报 — 从 InfoSearch 拉取',
  },
};

const DEMO_COPY: Record<(typeof LOCALES)[number], RegExp> = {
  en: /sample|demo|illustrative|\blive\b/i,
  es: /ejemplo|ilustrativ|en vivo|demostraci|muestra/i,
  fr: /exemple|illustratif|en direct|démo|\bdemo\b/i,
  it: /esempio|illustrativ|tempo reale|dimostr/i,
  pt: /exemplo|amostra|ilustrativ|ao vivo|demonstr/i,
  zh: /示例|实时|演示/,
};

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function catalog(locale: (typeof LOCALES)[number]): Record<(typeof CAPTION_KEYS)[number], string> {
  const json = JSON.parse(read(`public/locales/${locale}/crm.json`)) as {
    infoSearchLeads?: Record<string, string>;
  };
  const block = json.infoSearchLeads;
  if (!block) throw new Error(`${locale} crm catalog has no infoSearchLeads block`);
  return {
    captionPreview: block.captionPreview ?? '',
    captionLive: block.captionLive ?? '',
  };
}

function pageFallback(key: (typeof CAPTION_KEYS)[number]): string {
  const src = read('src/components/account-intel/InfoSearchLeadsCard.tsx');
  const match = src.match(new RegExp(`infoSearchLeads\\.${key}',\\s*'([^']*)'`));
  if (!match?.[1]) throw new Error(`InfoSearchLeadsCard is missing the ${key} fallback`);
  return match[1];
}

describe('InfoSearch lead caption copy', () => {
  it('keeps the preview flag and the InfoSearch credential path on the card', () => {
    const src = read('src/components/account-intel/InfoSearchLeadsCard.tsx');
    expect(src).toContain('leads.data?.preview');
    expect(src).toContain('INFOSEARCH_ENABLED');
    expect(src).toContain('/api/infosearch/leads?account=');
    for (const key of CAPTION_KEYS) expect(src).toContain(`infoSearchLeads.${key}`);
  });

  it('uses the English reference fallback on both captions', () => {
    for (const key of CAPTION_KEYS) {
      expect(pageFallback(key)).toBe(EXPECTED.en[key]);
    }
    const joined = CAPTION_KEYS.map((key) => pageFallback(key)).join(' ');
    expect(joined).toContain('Reference records');
    expect(joined).toContain('INFOSEARCH_ENABLED');
    expect(joined).not.toMatch(DEMO_COPY.en);
  });

  it.each(LOCALES)(
    '%s catalog calls fixture leads reference records and does not say live',
    (locale) => {
      const block = catalog(locale);
      expect(block).toEqual(EXPECTED[locale]);
      const joined = CAPTION_KEYS.map((key) => block[key]).join(' ');
      expect(joined).toContain('InfoSearch');
      expect(block.captionPreview).toContain('INFOSEARCH_ENABLED');
      expect(joined).not.toMatch(DEMO_COPY[locale]);
    },
  );
});
