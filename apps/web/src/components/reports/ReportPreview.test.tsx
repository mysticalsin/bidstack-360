// A plain opportunity preview lists every column the engine emits, including
// valueMicros. Demo deals are stored as integer micros (value * 1e6), and the
// preview used to print that integer. A €1.45M deal then reads as
// 1450000000000, which is not a deal amount. The column header was the key
// itself. A count beside a sum must stay a count.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatMoneyMicros } from '@/lib/format';
import type { ReportQuery, ReportRun } from '@/hooks/useAnalyticsReports';

import { ReportPreview } from './ReportPreview';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'en' },
  }),
}));

const RUSH_MICROS = 1_450_000_000_000;

function run(result: Array<Record<string, unknown>>): ReportRun {
  return {
    id: 'run-1',
    reportId: 'rep-1',
    status: 'done',
    result,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderPreview(query: ReportQuery, result: Array<Record<string, unknown>>) {
  return render(
    <ReportPreview
      chartType="table"
      query={query}
      run={run(result)}
      isLoading={false}
      error={null}
      onRun={() => undefined}
    />,
  );
}

describe('ReportPreview money cells', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows a demo opportunity amount as money, not the stored micros', () => {
    renderPreview(
      { entity: 'opportunity', limit: 100 },
      [
        {
          name: 'Clinical analytics',
          stage: 'closed_won',
          valueMicros: RUSH_MICROS,
          customer: 'Rush University System for Health',
        },
      ],
    );

    expect(screen.queryByText(String(RUSH_MICROS))).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeTruthy();
    expect(screen.getByText(formatMoneyMicros(RUSH_MICROS))).toBeTruthy();
    expect(screen.getByText('Clinical analytics')).toBeTruthy();
    expect(screen.getByText('closed_won')).toBeTruthy();
  });

  it('formats a summed value and leaves the deal count as a count', () => {
    renderPreview(
      {
        entity: 'opportunity',
        aggregates: [
          { fn: 'SUM', field: 'valueMicros', alias: 'value' },
          { fn: 'COUNT', field: '*', alias: 'deals' },
        ],
        groupBy: [{ field: 'stage' }],
      },
      [{ stage: 's4_negotiation', value: RUSH_MICROS, deals: 2 }],
    );

    expect(screen.queryByText(String(RUSH_MICROS))).toBeNull();
    expect(screen.getByText(formatMoneyMicros(RUSH_MICROS))).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('s4_negotiation')).toBeTruthy();
  });
});
