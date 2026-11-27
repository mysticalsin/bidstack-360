import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountKeyNumbers, KeyNumber } from '@bidstack/shared';

const state: { kn: AccountKeyNumbers | null } = { kn: null };
vi.mock('@/hooks/useAccountPositioning', () => ({
  useAccountKeyNumbers: () => ({ isLoading: false, isError: false, data: state.kn, refetch: vi.fn() }),
}));

import { KeyNumbersStrip } from './KeyNumbersStrip';

afterEach(cleanup);

const kn = (over: Partial<KeyNumber>): KeyNumber => ({
  id: 'x',
  group: 'company',
  label: 'X',
  value: null,
  unit: 'count',
  currency: null,
  delta: null,
  deltaUnit: null,
  goodWhen: 'up',
  series: [],
  sub: null,
  source: 'Sample data',
  period: 'FY2025 (to 2025-12-31)',
  sourceUrl: null,
  anchor: null,
  missing: null,
  sample: false,
  ...over,
});

describe('KeyNumbersStrip sample filings', () => {
  it('renders a fixture margin and the revenue from that source with a visible Sample label', () => {
    // WHY: a derived fixture margin must not be readable as a filed number.
    // The same Sample tag labels revenue that came from that fixture.
    state.kn = {
      companyId: 'c1',
      companyName: 'DNB Bank',
      computedAt: '2026-11-20T00:00:00Z',
      items: [
        kn({ id: 'margin', label: 'Operating margin', unit: 'pct', value: 59.8, sample: true }),
        kn({ id: 'revenue', label: 'Revenue', unit: 'money', currency: 'NOK', value: 85_300_000_000, sample: true }),
      ],
    };
    render(<KeyNumbersStrip companyId="c1" />);
    for (const id of ['kn-margin', 'kn-revenue']) {
      const tile = screen.getByTestId(id);
      const value = tile.querySelector('.kn-value');
      const tag = value?.getAttribute('aria-describedby')
        ? document.getElementById(value.getAttribute('aria-describedby')!)
        : null;
      expect(tag?.textContent).toBe('Sample');
      expect(tag?.classList.contains('sg-sample')).toBe(true);
      expect(tag?.getAttribute('aria-hidden')).not.toBe('true');
      expect(within(tile).getByText('Sample')).toBe(tag);
    }
  });
});
