import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const UNITS_61520_MICROS = '61520000000';

type AnalyticsPayload = {
  totalCount: number;
  wonCount: number;
  lostCount: number;
  totalValueMicros: string;
  byStatus: Array<{ status: string; count: number }>;
  byOwner: Array<{
    ownerId: string | null;
    ownerName: string;
    count: number;
    totalValueMicros: string;
  }>;
};

const analytics = vi.hoisted(() => ({
  current: {
    isLoading: false,
    isError: false,
    data: undefined as AnalyticsPayload | undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => analytics.current,
}));

import { RfpAnalyticsSection } from './RfpAnalyticsSection';

function digits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

describe('RFP analytics pipeline amount under demo data', () => {
  afterEach(() => {
    cleanup();
    analytics.current = { isLoading: false, isError: false, data: undefined };
  });

  it('does not price a synthetic pipeline of 61520 as euros', () => {
    // WHY: the admin rollup sums linked opportunity valueMicros. Those rows
    // do not store a currency. Demo synthetic bids were printed as euros, so
    // 61520 units looked like a euro forecast. The figure stays 61520 and
    // the screen does not name EUR.
    analytics.current = {
      isLoading: false,
      isError: false,
      data: {
        totalCount: 2,
        wonCount: 0,
        lostCount: 0,
        totalValueMicros: UNITS_61520_MICROS,
        byStatus: [{ status: 'draft', count: 2 }],
        byOwner: [
          {
            ownerId: 'user-demo-1',
            ownerName: 'Ada Owner',
            count: 2,
            totalValueMicros: UNITS_61520_MICROS,
          },
        ],
      },
    };

    render(<RfpAnalyticsSection />);

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toContain('61520');
    expect(screen.getByText('Ada Owner')).toBeTruthy();
    const amounts = screen.getAllByText((_, node) => {
      if (!node || node.children.length > 0) return false;
      return digits(node.textContent) === '61520';
    });
    expect(amounts).toHaveLength(2);
  });

  it('does not invent a euro zero while the rollup is still loading', () => {
    // WHY: the identity of the figure is the server string. Until that
    // answer arrives, a euro zero would be a number nobody loaded.
    analytics.current = { isLoading: true, isError: false, data: undefined };

    render(<RfpAnalyticsSection />);

    expect(document.body.textContent ?? '').not.toMatch(/EUR|€/);
    expect(screen.getAllByLabelText('Loading…').length).toBeGreaterThan(0);
  });
});
