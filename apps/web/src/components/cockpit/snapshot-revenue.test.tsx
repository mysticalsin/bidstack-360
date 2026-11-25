import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCurrencyStore } from '@/stores/currency';
import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { BusinessSnapshotCard } from './BusinessSnapshotCard';
import { snapshotRevenueAmount } from './snapshot-revenue';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
}));

const UNITS_61520_MICROS = 61_520_000_000;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function cockpit(annualRevenueMicros: number): AccountCockpitSnapshot {
  return {
    company: {
      id: 'northwind',
      name: 'Northwind Pharma',
      annualRevenueMicros,
      sourceAttribution: [],
      legalName: null,
      logo: null,
      confidence: 0.5,
      updatedAt: '2026-06-16T12:00:00.000Z',
    },
    kpis: [],
    technicalStack: [],
    health: { score: 80, band: 'good' },
    keyContacts: [],
    risks: [],
    compliance: [],
  } as AccountCockpitSnapshot;
}

describe('business snapshot revenue under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price an annual revenue of 61520 as euros', () => {
    // WHY: the snapshot prints company annualRevenueMicros. That field does not
    // store a currency. Demo synthetic revenue was sent through an EUR source,
    // so 61520 units looked like a euro forecast. The figure stays 61520 and
    // does not name EUR. Source badges stay on the row.
    useCurrencyStore.setState({ currency: 'EUR', rates: null });

    render(<BusinessSnapshotCard cockpit={cockpit(UNITS_61520_MICROS)} />);

    const region = screen.getByRole('region', { name: 'Business snapshot' });
    expect(region.querySelectorAll('.kv-source').length).toBeGreaterThan(0);
    expect(region.textContent).toContain('Annual revenue');

    const label = screen.getByText('Annual revenue');
    const text = label.parentElement?.textContent ?? '';
    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toBe('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a revenue figure that is not an integer micros value is not an
    // amount. It must not fall through to an EUR zero. Source badges stay
    // on the row.
    expect(snapshotRevenueAmount(Number.NaN)).toBe('Not a number');
    expect(snapshotRevenueAmount(1.5)).toBe('Not a number');
    expect(snapshotRevenueAmount('nope')).toBe('Not a number');
    expect(snapshotRevenueAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
