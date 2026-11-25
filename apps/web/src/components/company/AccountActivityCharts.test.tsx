import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCompanyActivitySummary', () => ({
  useCompanyActivitySummary: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

import { useHasPermission } from '@/hooks/useCapabilities';
import { useCompanyActivitySummary } from '@/hooks/useCompanyActivitySummary';

import { AccountActivityCharts } from './AccountActivityCharts';

afterEach(() => {
  cleanup();
  vi.mocked(useHasPermission).mockReturnValue(true);
});

const COMPANY = '00000000-0000-4000-8000-000000000003';

function summary(over: Record<string, unknown> = {}) {
  return {
    companyId: COMPANY,
    timezone: 'UTC',
    from: '2026-08-17T00:00:00.000Z',
    to: '2026-11-06T00:00:00.000Z',
    total: 5,
    byHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      call: hour === 9 ? 3 : 0,
      email: hour === 14 ? 2 : 0,
      meeting: 0,
      note: 0,
      stage_change: 0,
    })),
    weekly: [
      {
        weekStart: '2026-10-26',
        call: 1,
        email: 1,
        meeting: 0,
        note: 0,
        stage_change: 0,
        overdue: 0,
      },
      {
        weekStart: '2026-11-02',
        call: 2,
        email: 1,
        meeting: 0,
        note: 0,
        stage_change: 0,
        overdue: 2,
      },
    ],
    overdue: { count: 2, oldestDueAt: '2026-11-03T00:00:00.000Z' },
    ...over,
  };
}

function mockQuery(value: Record<string, unknown>) {
  vi.mocked(useCompanyActivitySummary).mockReturnValue(
    value as unknown as ReturnType<typeof useCompanyActivitySummary>,
  );
}

describe('AccountActivityCharts', () => {
  it('fetches nothing and renders nothing without activities:read', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    vi.mocked(useCompanyActivitySummary).mockClear();
    mockQuery({ data: undefined, isLoading: false, isError: false });
    const { container } = render(<AccountActivityCharts companyId={COMPANY} />);
    expect(useHasPermission).toHaveBeenCalledWith('activities:read');
    expect(useCompanyActivitySummary).toHaveBeenCalledWith(undefined, expect.any(String));
    expect(container.innerHTML).toBe('');
  });

  it('fetches nothing and renders nothing when the id is not a company UUID', () => {
    vi.mocked(useCompanyActivitySummary).mockClear();
    mockQuery({ data: undefined, isLoading: false, isError: false });
    const { container } = render(<AccountActivityCharts companyId="Acme Corp" />);
    expect(useCompanyActivitySummary).toHaveBeenCalledWith(undefined, expect.any(String));
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks for the summary in the browser time zone', () => {
    mockQuery({ data: summary(), isLoading: false, isError: false });
    render(<AccountActivityCharts companyId={COMPANY} />);
    expect(useCompanyActivitySummary).toHaveBeenCalledWith(COMPANY, expect.any(String));
  });

  it('draws both charts with the activity total and the overdue count', () => {
    mockQuery({ data: summary(), isLoading: false, isError: false });
    render(<AccountActivityCharts companyId={COMPANY} />);
    expect(screen.getByRole('heading', { name: 'Activity by hour' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Activity per week' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /busiest 09 with 3/i })).toBeTruthy();
    expect(screen.getByRole('img', { name: /overdue below the line/i })).toBeTruthy();
  });

  it('shows one empty sentence when the account has no activity', () => {
    mockQuery({
      data: summary({ total: 0, overdue: { count: 0, oldestDueAt: null } }),
      isLoading: false,
      isError: false,
    });
    render(<AccountActivityCharts companyId={COMPANY} />);
    expect(screen.getByText('No activity in the last 12 weeks.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  // Demo follow-ups are due in May 2026. On 25 Nov the chart is the last 12
  // weeks, so those late follow-ups never land on a bar. A blank chart, or a
  // chart that only draws newer calls, reads as a quiet account.
  it('names late follow-ups the week bars cannot draw', () => {
    mockQuery({
      data: summary({
        total: 0,
        byHour: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          call: 0,
          email: 0,
          meeting: 0,
          note: 0,
          stage_change: 0,
        })),
        weekly: [
          {
            weekStart: '2026-11-02',
            call: 0,
            email: 0,
            meeting: 0,
            note: 0,
            stage_change: 0,
            overdue: 0,
          },
          {
            weekStart: '2026-11-09',
            call: 0,
            email: 0,
            meeting: 0,
            note: 0,
            stage_change: 0,
            overdue: 0,
          },
        ],
        overdue: { count: 7, oldestDueAt: '2026-05-12T00:00:00.000Z' },
      }),
      isLoading: false,
      isError: false,
    });
    render(<AccountActivityCharts companyId={COMPANY} />);
    expect(
      screen.getByText(
        '7 open follow-ups are already late and outside this 2-week chart. Oldest due May 12, 2026.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Activity by hour' })).toBeNull();
    expect(screen.queryByText(/No activity in the last/)).toBeNull();
  });

  it('keeps the charts when newer activity exists and still names the late follow-ups the bars leave out', () => {
    const base = summary();
    mockQuery({
      data: summary({
        overdue: { count: 7, oldestDueAt: '2026-05-12T00:00:00.000Z' },
        weekly: base.weekly.map((week) => ({ ...week, overdue: 0 })),
      }),
      isLoading: false,
      isError: false,
    });
    render(<AccountActivityCharts companyId={COMPANY} />);
    expect(screen.getByRole('heading', { name: 'Activity per week' })).toBeTruthy();
    expect(
      screen.getByText(
        '7 open follow-ups are already late and outside this 2-week chart. Oldest due May 12, 2026.',
      ),
    ).toBeTruthy();
  });

  it('uses the singular when one late follow-up sits outside the chart', () => {
    mockQuery({
      data: summary({
        total: 0,
        weekly: [
          {
            weekStart: '2026-11-09',
            call: 0,
            email: 0,
            meeting: 0,
            note: 0,
            stage_change: 0,
            overdue: 0,
          },
        ],
        overdue: { count: 1, oldestDueAt: '2026-05-23T00:00:00.000Z' },
      }),
      isLoading: false,
      isError: false,
    });
    render(<AccountActivityCharts companyId={COMPANY} />);
    expect(
      screen.getByText(
        '1 open follow-up is already late and outside this 1-week chart. Oldest due May 23, 2026.',
      ),
    ).toBeTruthy();
  });

  it('does not call in-window overdue follow-ups outside the chart', () => {
    mockQuery({ data: summary(), isLoading: false, isError: false });
    render(<AccountActivityCharts companyId={COMPANY} />);
    expect(screen.queryByText(/outside this/)).toBeNull();
  });

  it('says so when the summary fails to load', () => {
    mockQuery({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<AccountActivityCharts companyId={COMPANY} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
