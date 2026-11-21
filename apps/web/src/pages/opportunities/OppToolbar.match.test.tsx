import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

import { OppKpiBar } from './OppToolbar';

import type { Opportunity } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback ?? key,
  }),
}));

afterEach(() => cleanup());

describe('OppKpiBar filtered totals', () => {
  it('uses the server total when the filter has more rows than the page', () => {
    // WHY: the visible page can be 1 row while the filter matches 51. The
    // cards must show the summary, not the page, and not the unfiltered org.
    const open = {
      value: 1_240_000,
      probability: 65,
      pipelineStage: null,
      stage: 's3_technical_iteration',
    } as Opportunity;
    render(
      <OppKpiBar
        opps={[open]}
        partial
        match={{
          count: 51,
          wonMicros: '0',
          openMicros: '2480000000000',
          weightedMicros: '1612000000000',
        }}
      />,
    );
    expect(screen.getByText('Matching')).toBeTruthy();
    expect(screen.getByText('51')).toBeTruthy();
    expect(screen.getByText(formatUnspecifiedAmount(2_480_000))).toBeTruthy();
    expect(screen.getByText(formatUnspecifiedAmount(1_612_000))).toBeTruthy();
    expect(screen.queryByText('This page is not the full match.')).toBeNull();
    expect(screen.queryByText('Opportunities (page)')).toBeNull();
    expect(screen.queryByText('WR (page)')).toBeNull();
  });
});
