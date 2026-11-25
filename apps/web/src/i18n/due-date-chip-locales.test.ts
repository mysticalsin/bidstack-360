// WHY: the curated demo stamps every bid 45 days out
// (packages/db/src/seed-org-data.ts). The prototype book leaves CI Financial
// (OP-2041) due 2026-07-22, which is 126 days overdue on 2026-11-25. The chip
// already passes count into t(), but dueDateChip lives only in the English
// catalog, so French, Spanish, Portuguese, Italian, and Chinese all paint
// "45d left" and "126d overdue". Those four languages also need a singular
// for one day. Arabic catalogs stay on the open Arabic pull request.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createInstance, type i18n as I18nInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

const TRANSLATED = ['fr', 'es', 'pt', 'it', 'zh'] as const;
const DEMO_DAYS_LEFT = 45;
const DEMO_TODAY = '2026-11-25';
const CI_FINANCIAL_DUE = '2026-07-22';

type ChipCopy = {
  daysLeftOne: string;
  daysLeftOther: string;
  daysLeftZero: string;
  overdueOne: string;
  overdueOther: string;
  dueToday: string;
  noDate: string;
  ariaLabel: string;
  ariaLabelNoDate: string;
};

const COPY: Record<'en' | (typeof TRANSLATED)[number], ChipCopy> = {
  en: {
    daysLeftOne: '1d left',
    daysLeftOther: '45d left',
    daysLeftZero: '0d left',
    overdueOne: '1d overdue',
    overdueOther: '126d overdue',
    dueToday: 'Due today',
    noDate: 'No date',
    ariaLabel: 'Due 22 Jul 2026',
    ariaLabelNoDate: 'No due date set',
  },
  fr: {
    daysLeftOne: '1 j restant',
    daysLeftOther: '45 j restants',
    daysLeftZero: '0 j restant',
    overdueOne: '1 j de retard',
    overdueOther: '126 j de retard',
    dueToday: "Aujourd'hui",
    noDate: 'Aucune date',
    ariaLabel: 'Échéance le 22 Jul 2026',
    ariaLabelNoDate: "Aucune date d'échéance",
  },
  es: {
    daysLeftOne: '1 d restante',
    daysLeftOther: '45 d restantes',
    daysLeftZero: '0 d restantes',
    overdueOne: '1 d de retraso',
    overdueOther: '126 d de retraso',
    dueToday: 'Vence hoy',
    noDate: 'Sin fecha',
    ariaLabel: 'Vence el 22 Jul 2026',
    ariaLabelNoDate: 'Sin fecha de vencimiento',
  },
  pt: {
    daysLeftOne: '1 d restante',
    daysLeftOther: '45 d restantes',
    daysLeftZero: '0 d restantes',
    overdueOne: '1 d em atraso',
    overdueOther: '126 d em atraso',
    dueToday: 'Vence hoje',
    noDate: 'Sem data',
    ariaLabel: 'Vence em 22 Jul 2026',
    ariaLabelNoDate: 'Sem data de vencimento',
  },
  it: {
    daysLeftOne: '1 g rimanente',
    daysLeftOther: '45 g rimanenti',
    daysLeftZero: '0 g rimanenti',
    overdueOne: '1 g di ritardo',
    overdueOther: '126 g di ritardo',
    dueToday: 'Scade oggi',
    noDate: 'Nessuna data',
    ariaLabel: 'Scadenza 22 Jul 2026',
    ariaLabelNoDate: 'Nessuna data di scadenza',
  },
  zh: {
    daysLeftOne: '还剩 1 天',
    daysLeftOther: '还剩 45 天',
    daysLeftZero: '还剩 0 天',
    overdueOne: '逾期 1 天',
    overdueOther: '逾期 126 天',
    dueToday: '今天到期',
    noDate: '无日期',
    ariaLabel: '到期日 22 Jul 2026',
    ariaLabelNoDate: '未设置到期日',
  },
};

function utcDays(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
}

function catalog(locale: string): Record<string, unknown> {
  const raw = readFileSync(join(process.cwd(), 'public/locales', locale, 'crm.json'), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{[^}]+\}\}/g)].map((match) => match[0]).sort();
}

async function chipI18n(locale: string): Promise<I18nInstance> {
  const instance = createInstance();
  const resources = Object.fromEntries(
    (['en', ...TRANSLATED] as const).map((code) => [code, { crm: catalog(code) }]),
  );
  await instance.init({
    lng: locale,
    fallbackLng: 'en',
    ns: ['crm'],
    defaultNS: 'crm',
    resources,
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  return instance;
}

describe('due date chip copy for the demo book', () => {
  it('keeps the demo counts that the chip has to say', () => {
    const orgSeed = readFileSync(
      join(process.cwd(), '../../packages/db/src/seed-org-data.ts'),
      'utf8',
    );
    const fixtures = readFileSync(
      join(process.cwd(), '../../packages/db/src/seed-data.ts'),
      'utf8',
    );
    expect(orgSeed).toContain('dueDate: daysFromNow(45)');
    expect(fixtures).toContain("code: 'OP-2041'");
    expect(fixtures).toContain("dueDate: '2026-07-22'");
    expect(utcDays(CI_FINANCIAL_DUE, DEMO_TODAY)).toBe(126);
    expect(DEMO_DAYS_LEFT).toBe(45);
  });

  it('still passes count so one day and many days can differ', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/ui/DueDateChip.tsx'), 'utf8');
    expect(src).toMatch(/dueDateChip\.daysLeft[\s\S]{0,80}count:\s*days/);
    expect(src).toMatch(/dueDateChip\.overdueBy[\s\S]{0,120}count:/);
  });

  it('says 45 days left and the CI Financial overdue count in each translated locale', async () => {
    const english = COPY.en;
    for (const locale of TRANSLATED) {
      const expected = COPY[locale];
      const i18n = await chipI18n(locale);
      const daysLeft = (count: number) => i18n.t('dueDateChip.daysLeft', { count });
      const overdue = (count: number) => i18n.t('dueDateChip.overdueBy', { count });

      expect(daysLeft(1), locale).toBe(expected.daysLeftOne);
      expect(daysLeft(DEMO_DAYS_LEFT), locale).toBe(expected.daysLeftOther);
      expect(daysLeft(0), locale).toBe(expected.daysLeftZero);
      expect(daysLeft(DEMO_DAYS_LEFT), locale).not.toBe(english.daysLeftOther);

      expect(overdue(1), locale).toBe(expected.overdueOne);
      expect(overdue(utcDays(CI_FINANCIAL_DUE, DEMO_TODAY)), locale).toBe(expected.overdueOther);
      expect(overdue(utcDays(CI_FINANCIAL_DUE, DEMO_TODAY)), locale).not.toBe(english.overdueOther);

      expect(i18n.t('dueDateChip.dueToday'), locale).toBe(expected.dueToday);
      expect(i18n.t('dueDateChip.noDate'), locale).toBe(expected.noDate);
      expect(i18n.t('dueDateChip.ariaLabel', { date: '22 Jul 2026' }), locale).toBe(expected.ariaLabel);
      expect(i18n.t('dueDateChip.ariaLabelNoDate'), locale).toBe(expected.ariaLabelNoDate);
    }
  });

  it('keeps the English chip compact for one day and for the demo count', async () => {
    const i18n = await chipI18n('en');
    expect(i18n.t('dueDateChip.daysLeft', { count: 1 })).toBe(COPY.en.daysLeftOne);
    expect(i18n.t('dueDateChip.daysLeft', { count: DEMO_DAYS_LEFT })).toBe(COPY.en.daysLeftOther);
    expect(i18n.t('dueDateChip.daysLeft', { count: 0 })).toBe(COPY.en.daysLeftZero);
    expect(i18n.t('dueDateChip.overdueBy', { count: 1 })).toBe(COPY.en.overdueOne);
    expect(i18n.t('dueDateChip.overdueBy', { count: 126 })).toBe(COPY.en.overdueOther);
    expect(i18n.t('dueDateChip.dueToday')).toBe(COPY.en.dueToday);
    expect(i18n.t('dueDateChip.noDate')).toBe(COPY.en.noDate);
  });

  it('keeps the count and date placeholders on every plural form', () => {
    for (const locale of ['en', ...TRANSLATED] as const) {
      const block = catalog(locale).dueDateChip as Record<string, string>;
      expect(block, locale).toBeTruthy();
      for (const key of ['daysLeft_one', 'daysLeft_other', 'overdueBy_one', 'overdueBy_other'] as const) {
        expect(placeholders(block[key] ?? ''), `${locale}.${key}`).toEqual(['{{count}}']);
      }
      expect(placeholders(block.ariaLabel ?? ''), `${locale}.ariaLabel`).toEqual(['{{date}}']);
      expect(block.dueToday, `${locale}.dueToday`).not.toMatch(/\{\{/);
      expect(block.noDate, `${locale}.noDate`).not.toMatch(/\{\{/);
    }
  });
});
