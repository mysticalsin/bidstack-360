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

  it('says so when the summary fails to load', () => {
    mockQuery({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<AccountActivityCharts companyId={COMPANY} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
