import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductsTab, SolutionsTab } from './IntelTabs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

const files = [{ id: '11111111-1111-4111-8111-111111111111', name: 'solution-brief.pdf' }];

afterEach(() => {
  cleanup();
});

describe('IntelTabs source badges', () => {
  it('prefers API fieldSources over local document fallback on solution cards', () => {
    render(
      <SolutionsTab
        solutions={[
          {
            id: 'solution-1',
            name: 'Cloud modernization',
            description: 'Migration and landing-zone advisory.',
            category: 'consulting',
            status: 'active',
            confidenceBps: 5200,
            extractedFromDocumentId: files[0]!.id,
            fieldSources: {
              name: {
                source: 'derived:dust',
                label: 'Dust extraction',
                hint: 'Dust extraction from solution-brief.pdf with 85% confidence. Saved 2026-06-17.',
                confidence: 0.85,
                sourceFileId: files[0]!.id,
                sourceFileName: files[0]!.name,
                sourceExtractionId: '22222222-2222-4222-8222-222222222222',
                updatedAt: '2026-06-17T12:00:00.000Z',
              },
              category: {
                source: 'derived:dust',
                label: 'Dust extraction',
                hint: 'Category extracted from solution-brief.pdf with 82% confidence.',
                confidence: 0.82,
                sourceFileId: files[0]!.id,
                sourceFileName: files[0]!.name,
                sourceExtractionId: '22222222-2222-4222-8222-222222222222',
                updatedAt: '2026-06-17T12:00:00.000Z',
              },
              status: {
                source: 'manual',
                label: 'Manual review',
                hint: 'Status confirmed by account owner on 2026-06-17.',
                confidence: 1,
                sourceFileId: null,
                sourceFileName: null,
                sourceExtractionId: null,
                updatedAt: '2026-06-17T12:05:00.000Z',
              },
            },
          },
        ]}
        files={files}
        onDelete={vi.fn()}
        isDeleting={false}
      />,
    );

    const source = screen.getByTestId('solution-solution-1-source');
    expect(source.textContent).toContain('Dust extraction');
    expect(source.getAttribute('aria-label')).toBe(
      'Dust extraction from solution-brief.pdf with 85% confidence. Saved 2026-06-17.',
    );
    expect(screen.getByTestId('solution-solution-1-confidence').textContent).toContain(
      '85% confidence',
    );
    expect(screen.getByTestId('solution-solution-1-field-source-category').textContent).toBe(
      'Category',
    );
    expect(
      screen.getByTestId('solution-solution-1-field-source-category').getAttribute('aria-label'),
    ).toBe('Category source: Category extracted from solution-brief.pdf with 82% confidence.');
    expect(screen.getByTestId('solution-solution-1-field-source-status').textContent).toBe(
      'Status',
    );
    expect(
      screen.getByTestId('solution-solution-1-field-source-status').getAttribute('aria-label'),
    ).toBe('Status source: Status confirmed by account owner on 2026-06-17.');
  });

  it('shows document source and exact confidence on solution cards', () => {
    render(
      <SolutionsTab
        solutions={[
          {
            id: 'solution-1',
            name: 'Cloud modernization',
            description: 'Migration and landing-zone advisory.',
            category: 'consulting',
            status: 'active',
            confidenceBps: 8500,
            extractedFromDocumentId: files[0]!.id,
          },
        ]}
        files={files}
        onDelete={vi.fn()}
        isDeleting={false}
      />,
    );

    const source = screen.getByTestId('solution-solution-1-source');
    expect(source.textContent).toContain('solution-brief.pdf');
    expect(source.getAttribute('aria-label')).toBe(
      'Extracted from solution-brief.pdf with 85% confidence.',
    );
    expect(screen.getByTestId('solution-solution-1-confidence').textContent).toContain(
      '85% confidence',
    );
  });

  it('shows manual source fallback and exact confidence on product cards', () => {
    render(
      <ProductsTab
        products={[
          {
            id: 'product-1',
            name: 'Managed workspace',
            description: null,
            category: 'service',
            priceRangeMicros: null,
            currency: 'EUR',
            status: 'draft',
            confidenceBps: 4300,
            extractedFromDocumentId: null,
            fieldSources: {
              priceRangeMicros: {
                source: 'derived:deterministic',
                label: 'Document extraction',
                hint: 'Price range normalized from product catalog with 64% confidence.',
                confidence: 0.64,
                sourceFileId: files[0]!.id,
                sourceFileName: files[0]!.name,
                sourceExtractionId: '33333333-3333-4333-8333-333333333333',
                updatedAt: '2026-06-17T12:00:00.000Z',
              },
              currency: {
                source: 'manual',
                label: 'Manual review',
                hint: 'Currency set by finance owner.',
                confidence: 1,
                sourceFileId: null,
                sourceFileName: null,
                sourceExtractionId: null,
                updatedAt: '2026-06-17T12:05:00.000Z',
              },
            },
          },
        ]}
        files={files}
        onDelete={vi.fn()}
        isDeleting={false}
      />,
    );

    const source = screen.getByTestId('product-product-1-source');
    expect(source.textContent).toContain('Manual');
    expect(source.getAttribute('aria-label')).toBe(
      'Stored account intelligence record with 43% confidence.',
    );
    expect(screen.getByTestId('product-product-1-confidence').textContent).toContain(
      '43% confidence',
    );
    expect(screen.getByTestId('product-product-1-field-source-priceRangeMicros').textContent).toBe(
      'Price',
    );
    expect(
      screen
        .getByTestId('product-product-1-field-source-priceRangeMicros')
        .getAttribute('aria-label'),
    ).toBe('Price source: Price range normalized from product catalog with 64% confidence.');
    expect(screen.getByTestId('product-product-1-field-source-currency').textContent).toBe(
      'Currency',
    );
    expect(
      screen.getByTestId('product-product-1-field-source-currency').getAttribute('aria-label'),
    ).toBe('Currency source: Currency set by finance owner.');
  });
});
