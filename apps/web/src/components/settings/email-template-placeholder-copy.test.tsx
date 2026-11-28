// A seller hovering a placeholder chip is told the fill-in is a "sample".
// That word reads as demo data on a template the seller can send. The chip
// must call the fill-in a reference. The catalog field stays `sample` — it
// is the fixture example, not a badge — and the token ids stay put.
// Nothing on the chip is marked live.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const LOCALES = ['en', 'es', 'fr', 'it', 'pt', 'zh'] as const;

/** Production caption. `{{sample}}` stays: it is the fixture field, not the badge. */
const EXPECTED: Record<(typeof LOCALES)[number], string> = {
  en: '{{label}} — reference: {{sample}}',
  es: '{{label}} — referencia: {{sample}}',
  fr: '{{label}} — référence : {{sample}}',
  it: '{{label}} — riferimento: {{sample}}',
  pt: '{{label}} — referência: {{sample}}',
  zh: '{{label}} — 参考：{{sample}}',
};

const DEMO_COPY: Record<(typeof LOCALES)[number], RegExp> = {
  en: /\bsample\b|\bdemo\b|illustrative|\blive\b/i,
  es: /ejemplo|muestra|demostraci|\ben vivo\b/i,
  fr: /exemple|illustratif|en direct|démo|\bdemo\b/i,
  it: /esempio|illustrativ|tempo reale|dimostr/i,
  pt: /exemplo|ilustrativ|ao vivo|demonstr/i,
  zh: /示例|实时|演示/,
};

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/** Seller-facing words, with the fixture interpolation taken out. */
function sellerWords(copy: string): string {
  return copy.replace(/\{\{sample\}\}/g, '').replace(/\{\{label\}\}/g, '');
}

function catalog(locale: (typeof LOCALES)[number]): string {
  const json = JSON.parse(read(`public/locales/${locale}/settings.json`)) as {
    emailTemplates?: { placeholderTitle?: string };
  };
  const title = json.emailTemplates?.placeholderTitle;
  if (!title) throw new Error(`${locale} settings catalog has no emailTemplates.placeholderTitle`);
  return title;
}

function componentFallback(): string {
  const src = read('src/components/settings/EmailTemplatesSection.tsx');
  const match = src.match(/emailTemplates\.placeholderTitle',\s*'([^']*)'/);
  if (!match?.[1]) throw new Error('EmailTemplatesSection is missing the placeholder title fallback');
  return match[1];
}

const hookMocks = vi.hoisted(() => ({
  useEmailTemplates: vi.fn(),
  useCreateEmailTemplate: vi.fn(),
  useUpdateEmailTemplate: vi.fn(),
  useDeleteEmailTemplate: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) => {
      if (!vars) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        vars[name] == null ? `{{${name}}}` : String(vars[name]),
      );
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useEmailTemplates', () => ({
  useEmailTemplates: hookMocks.useEmailTemplates,
  useCreateEmailTemplate: hookMocks.useCreateEmailTemplate,
  useUpdateEmailTemplate: hookMocks.useUpdateEmailTemplate,
  useDeleteEmailTemplate: hookMocks.useDeleteEmailTemplate,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { EmailTemplatesSection } from './EmailTemplatesSection';

describe('email template placeholder chips keep fixture examples', () => {
  it('keeps the sample field, the token ids, and the placeholderTitle key', () => {
    // WHY: rewording the badge must not rename the fixture example or the
    // token a seller inserts. `sample: 'Aisha'` is the fill-in, not the caption.
    const schema = read('../../packages/shared/src/schemas/email-template.ts');
    const section = read('src/components/settings/EmailTemplatesSection.tsx');
    expect(schema).toContain("token: 'lead.firstName'");
    expect(schema).toContain("sample: 'Aisha'");
    expect(schema).not.toMatch(/label: '[^']*\bSample\b/);
    expect(section).toContain('sample: p.sample');
    expect(section).toContain('emailTemplates.placeholderTitle');
    expect(section).toContain('PLACEHOLDER_CATALOG');
    for (const locale of LOCALES) {
      expect(catalog(locale)).toContain('{{sample}}');
      expect(catalog(locale)).toContain('{{label}}');
    }
  });
});

describe('email template placeholder chips call the fill-in a reference', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses the English reference fallback on the chip', () => {
    const fallback = componentFallback();
    expect(fallback).toBe(EXPECTED.en);
    expect(fallback).toContain('{{sample}}');
    expect(sellerWords(fallback)).not.toMatch(DEMO_COPY.en);
  });

  it.each(LOCALES)('%s catalog calls the placeholder fill-in a reference', (locale) => {
    const title = catalog(locale);
    expect(title).toBe(EXPECTED[locale]);
    expect(title).toContain('{{sample}}');
    expect(sellerWords(title)).not.toMatch(DEMO_COPY[locale]);
  });

  it('shows reference on the chip and still inserts the fixture example', () => {
    hookMocks.useEmailTemplates.mockReturnValue({
      data: { items: [], pageContinues: false },
      isLoading: false,
    });
    hookMocks.useCreateEmailTemplate.mockReturnValue({ mutateAsync: vi.fn() });
    hookMocks.useUpdateEmailTemplate.mockReturnValue({ mutateAsync: vi.fn() });
    hookMocks.useDeleteEmailTemplate.mockReturnValue({ mutateAsync: vi.fn() });

    render(<EmailTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'New template' }));

    const chip = screen.getByRole('button', { name: '{{lead.firstName}}' });
    expect(chip.getAttribute('title')).toBe('Lead — first name — reference: Aisha');
    expect(chip.textContent).toBe('{{lead.firstName}}');

    const titles = screen
      .getAllByRole('button')
      .map((el) => el.getAttribute('title'))
      .filter((title): title is string => title != null && title.length > 0);
    expect(titles.length).toBeGreaterThan(1);
    for (const title of titles) {
      expect(title).toMatch(/reference:/);
      expect(title).not.toMatch(DEMO_COPY.en);
    }
  });
});
