import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { formatMicrosDecimal } from '@bidstack/shared';

import { AccountVisuals } from '@/components/account/AccountVisuals';
import { forecastAmount, type OppRow } from '@/components/viz/viz-data';
import { QuarterBars } from '@/components/viz/bklit-adapters';
import { fmtCompact } from '@/components/viz/viz-data';

const tips = vi.hoisted(() => ({
  rows: [] as Array<(point: Record<string, unknown>) => Array<{ label: string; value: unknown }>>,
}));

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: (props: React.ComponentProps<typeof actual.ResponsiveContainer>) => (
      <actual.ResponsiveContainer {...props} width={480} height={220} />
    ),
  };
});

vi.mock('@/components/charts/chart-parent-size', () => ({
  ParentSize: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 480, height: 200 }),
}));

vi.mock('@/components/charts/tooltip', () => ({
  ChartTooltip: (props: { rows: (point: Record<string, unknown>) => Array<{ label: string; value: unknown }> }) => {
    tips.rows.push(props.rows);
    return <div data-testid="forecast-tip" />;
  },
}));

vi.mock('@/hooks/useOpportunityRows', () => ({
  useOpportunityRows: () => ({ data: { items: (globalThis as { __acctRows?: OppRow[] }).__acctRows ?? [] } }),
}));

vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => ({ data: { people: [] } }),
}));

afterEach(() => {
  cleanup();
  tips.rows.length = 0;
});

const hugeMicros = ((BigInt(Number.MAX_SAFE_INTEGER) + 2n) * 1_000_000n).toString();
const exactHuge = formatMicrosDecimal(BigInt(hugeMicros));

describe('account stage bars', () => {
  it('shows the exact micros label on the stage bar and the table', () => {
    // WHY: StageBars formats Number(value) and drops the micros label.
    // A total past a safe integer must stay the shared money text. PR #73.
    (globalThis as { __acctRows?: OppRow[] }).__acctRows = [{
      id: 'deal-1',
      stage: 's2_sent',
      value: 12,
      valueMicros: hugeMicros,
      dueDate: null,
      customer: 'Acme',
    }];
    render(
      <MemoryRouter>
        <AccountVisuals companyId="c1" companyName="Acme" />
      </MemoryRouter>,
    );
    const pipeline = screen.getByTestId('account-pipeline');
    expect(pipeline.textContent).toContain(exactHuge);
    fireEvent.click(within(pipeline).getByRole('button', { name: 'Table' }));
    expect(within(pipeline).getByRole('cell', { name: exactHuge })).toBeTruthy();
    expect(document.body.textContent).not.toContain('€');
  });
});

describe('forecast tooltips', () => {
  it('keeps a large micros digit string as the shared money label', () => {
    // WHY: a digit string past a safe integer was labelled unreadable, then
    // the tooltip formatted Number(0). The shared money text keeps every digit.
    const point = forecastAmount({
      wonMicros: hugeMicros,
      weightedMicros: '0',
      openMicros: '0',
    });
    expect(point.wonLabel).toBe(exactHuge);
    expect(point.won).toBe(0);
  });

  it('shows that exact label and the unreadable state in the tooltip', () => {
    // WHY: QuarterBars formats Number(won) and Number(weighted), so hover
    // drops the label. PR #74.
    render(
      <QuarterBars
        data={[{
          label: 'Q1 2026',
          won: 0,
          weighted: 0,
          wonLabel: exactHuge,
          weightedLabel: '0',
        }]}
        format={fmtCompact}
      />,
    );
    const rows = tips.rows.at(-1)?.({
      label: 'Q1 2026',
      won: 0,
      weighted: 0,
      wonLabel: exactHuge,
      weightedLabel: '0',
    });
    expect(rows?.find((row) => row.label === 'Won')?.value).toBe(exactHuge);
    cleanup();
    tips.rows.length = 0;
    const unread = forecastAmount({
      wonMicros: Number.MAX_SAFE_INTEGER + 2,
      weightedMicros: '0',
      openMicros: '0',
    });
    render(
      <QuarterBars
        data={[{
          label: 'Q2 2026',
          won: unread.won,
          weighted: unread.weighted,
          wonLabel: unread.wonLabel,
          weightedLabel: unread.weightedLabel,
        }]}
        format={fmtCompact}
      />,
    );
    const unreadRows = tips.rows.at(-1)?.({
      label: 'Q2 2026',
      won: unread.won,
      weighted: unread.weighted,
      wonLabel: unread.wonLabel,
      weightedLabel: unread.weightedLabel,
    });
    expect(unreadRows?.find((row) => row.label === 'Won')?.value).toBe('amount not readable');
  });
});
