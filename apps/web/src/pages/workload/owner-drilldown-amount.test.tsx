import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { OwnerDrilldown } from '@/pages/workload/OwnerDrilldown';
import { useCurrencyStore } from '@/stores/currency';

import { ownerDrilldownAmount } from './owner-drilldown-amount';

const items = vi.hoisted(() => ({
  current: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: () => ({
    data: { items: items.current, nextCursor: null },
    isLoading: false,
    isError: false,
  }),
}));

const OPP_ID = '44444444-4444-4444-8444-444444444444';

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function openBid(value: number): Record<string, unknown> {
  return {
    id: OPP_ID,
    code: 'OP-1201',
    customer: 'Ada Rail',
    name: 'Signalling desk',
    stage: 's2_sent',
    pipelineStageId: null,
    pipelineStage: null,
    value,
    probability: 40,
    dueDate: null,
    owner: 'ada@example.com',
    industry: null,
    logo: null,
    country: null,
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-07-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
  };
}

describe('owner drilldown amount under demo data', () => {
  afterEach(() => {
    cleanup();
    items.current = [];
  });

  it('does not price a drilldown of 61520 as euros', () => {
    // WHY: the owner drilldown prints opportunity value. Those rows do not
    // store a currency. Demo synthetic pipeline was sent through an EUR
    // source, so a live bid of 61520 units looked like a euro forecast.
    // The figure stays 61520 and does not name EUR. The desk row is separate.
    useCurrencyStore.setState({ currency: 'EUR', rates: null });
    items.current = [openBid(61520)];

    render(
      <MemoryRouter>
        <OwnerDrilldown email="ada@example.com" ownerLabel="Ada Owner" />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link');
    const amount = link.querySelector('.tabular-nums');
    const text = amount?.textContent ?? '';
    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toBe('61520');
  });

  it('does not invent a euro zero when the units are not a safe integer', () => {
    // WHY: a drilldown figure that is not an integer unit value is not an
    // amount. It must not fall through to an EUR zero. The desk row is separate.
    expect(ownerDrilldownAmount(Number.NaN)).toBe('Not a number');
    expect(ownerDrilldownAmount(1.5)).toBe('Not a number');
    expect(ownerDrilldownAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
