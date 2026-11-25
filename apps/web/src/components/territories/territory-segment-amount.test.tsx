import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!opts) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(opts[name] ?? ''));
    },
  }),
}));

import { TerritorySegmentBreakdown } from './TerritorySegmentBreakdown';

const UNITS_61520_MICROS = 61_520_000_000;

function digits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

describe('territory segment amount under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price the first unpaid segment of 61520 as euros', () => {
    // WHY: segment bars sum opportunity valueMicros. Those rows do not store
    // a currency. Demo synthetic pipeline was sent through an EUR source, so
    // the first unpaid segment of 61520 units looked like a euro forecast.
    // The figure stays 61520 and the row does not name EUR. The bar scale
    // stays the segment max.
    const formatMoneyMicros = vi.fn((micros: number) => `EUR ${micros}`);

    render(
      <TerritorySegmentBreakdown
        dimension="account"
        segments={[
          {
            key: 'first-unpaid',
            label: 'First unpaid',
            opportunityCount: 1,
            totalValueMicros: UNITS_61520_MICROS,
            avgProbability: 40,
            ownerNames: ['Ada Owner'],
          },
          {
            key: 'later',
            label: 'Later segment',
            opportunityCount: 1,
            totalValueMicros: 1_000_000,
            avgProbability: 10,
            ownerNames: [],
          },
        ]}
        isLoading={false}
        isError={false}
        onRetry={() => undefined}
        formatMoneyMicros={formatMoneyMicros}
      />,
    );

    const first = screen.getByText('First unpaid').parentElement;
    const text = first?.textContent ?? '';
    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toContain('61520');
    expect(formatMoneyMicros).not.toHaveBeenCalled();
    expect(screen.getByText('Later segment')).toBeTruthy();
  });
});
