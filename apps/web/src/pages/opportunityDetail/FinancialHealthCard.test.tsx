import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntelPayload } from '@bidstack/shared';

import { FinancialHealthCard } from './IntelCards';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

const useCompany = vi.fn();
vi.mock('@/hooks/useCompanies', () => ({
  useCompany: (id: string | undefined) => useCompany(id),
}));

describe('FinancialHealthCard', () => {
  afterEach(() => {
    cleanup();
    useCompany.mockReset();
  });

  it('shows the account headcount and leaves unrecorded lines unknown', () => {
    // WHY: the deal card used to say unknown for headcount even when the
    // linked company had a stored count. That count is not a market probe.
    useCompany.mockReturnValue({
      data: { employeeCount: 2500, name: 'CI Financial', annualRevenueMicros: 1_200_000_000_000_000 },
    });
    render(<FinancialHealthCard intel={{} as IntelPayload} companyId="company-1" />);

    expect(screen.getByText('2,500 recorded on the account')).toBeTruthy();
    expect(screen.getByText(/1\.2B unspecified recorded on the account/)).toBeTruthy();
    expect(screen.queryByText(/\$|€/)).toBeNull();
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
    expect(screen.queryByText(/market cap/i)).toBeTruthy();
    expect(useCompany).toHaveBeenCalledWith('company-1');
  });

  it('prints account revenue past the safe unit count in full', () => {
    // WHY: compacting the collapsed unit number prints one unit low, and a bare
    // integer can be read as the display currency.
    const huge = (9007199254740993n * 1_000_000n).toString();
    useCompany.mockReturnValue({
      data: {
        name: 'CI Financial',
        annualRevenueMicros: Number(huge),
        annualRevenueMicrosText: huge,
      },
    });
    render(<FinancialHealthCard intel={{} as IntelPayload} companyId="company-1" />);
    expect(
      screen.getByText('9,007,199,254,740,993 unspecified recorded on the account'),
    ).toBeTruthy();
    expect(screen.queryByText(/9,007,199,254,740,992/)).toBeNull();
  });

  it('does not compact a revenue number that is no longer an exact micros integer', () => {
    // WHY: the JSON number has already collapsed. Printing it would look recorded.
    useCompany.mockReturnValue({
      data: {
        name: 'CI Financial',
        annualRevenueMicros: Number('9007199254740993'),
      },
    });
    render(<FinancialHealthCard intel={{} as IntelPayload} companyId="company-1" />);
    expect(screen.queryByText(/recorded on the account/)).toBeNull();
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
  });

  it('does not invent a headcount when the deal is not linked', () => {
    useCompany.mockReturnValue({ data: undefined });
    render(<FinancialHealthCard intel={{} as IntelPayload} companyId={null} />);
    expect(screen.queryByText(/recorded on the account/)).toBeNull();
    expect(useCompany).toHaveBeenCalledWith(undefined);
  });
});
