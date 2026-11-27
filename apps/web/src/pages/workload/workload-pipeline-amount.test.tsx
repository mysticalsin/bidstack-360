import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { WorkloadOwner } from '@/hooks/useWorkload';
import WorkloadPage from '@/pages/WorkloadPage';
import { useCurrencyStore } from '@/stores/currency';

import { workloadPipelineAmount } from './workload-pipeline-amount';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const owners = vi.hoisted(() => ({ current: [] as WorkloadOwner[] }));

vi.mock('@/hooks/useWorkload', () => ({
  useWorkload: () => ({
    data: { generatedAt: '2026-07-05T08:00:00.000Z', owners: owners.current },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const UNITS_61520_MICROS = '61520000000';

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

describe('workload weighted pipeline amount under demo data', () => {
  afterEach(() => {
    cleanup();
    owners.current = [];
  });

  it('does not price a weighted pipeline of 61520 as euros', () => {
    // WHY: the team total sums opportunity valueMicros. Those rows do not
    // store a currency. Demo synthetic pipeline was sent through an EUR
    // source, so a weighted total of 61520 units looked like a euro forecast.
    // The figure stays 61520 and does not name EUR. The desk rows are separate.
    useCurrencyStore.setState({ currency: 'EUR', rates: null });
    owners.current = [
      {
        ownerId: '11111111-1111-4111-8111-111111111111',
        name: 'Ada Owner',
        email: 'ada@example.com',
        openBids: 1,
        openValueMicros: UNITS_61520_MICROS,
        weightedValueMicros: UNITS_61520_MICROS,
        openTasks: 0,
        overdueTasks: 0,
        closingWithin7Days: 0,
      },
    ];

    render(
      <MemoryRouter>
        <WorkloadPage />
      </MemoryRouter>,
    );

    const tile = screen.getByTestId('workload-kpi-weighted').textContent ?? '';
    expect(tile).not.toMatch(/EUR|€/);
    expect(digits(tile)).toBe('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a team total that is not an integer micros value is not an
    // amount. It must not fall through to an EUR zero. Desk rows are separate.
    expect(workloadPipelineAmount(Number.NaN)).toBe('Not a number');
    expect(workloadPipelineAmount(1.5)).toBe('Not a number');
    expect(workloadPipelineAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
