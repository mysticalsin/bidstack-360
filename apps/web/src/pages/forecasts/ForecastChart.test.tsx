import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastChart } from './ForecastChart';
import type { ChartDatum } from './forecastsConfig';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const huge = (9007199254740993n * 1_000_000n).toString();

function datum(currency: string, commit: string, pipeline = '0'): ChartDatum {
  return {
    period: '2026-Q2',
    currency,
    pipeline,
    bestCase: '0',
    commit,
    closed: '0',
  };
}

describe('ForecastChart', () => {
  afterEach(cleanup);

  it('draws a recorded currency on its own series', () => {
    // WHY: the dollar commit used to be dropped, so the bar was only the unspecified book.
    render(
      <ForecastChart
        chartData={[datum('XXX', '0', '1000000'), datum('USD', huge)]}
      />,
    );

    expect(screen.getByText('Unspecified')).toBeTruthy();
    expect(screen.getByText('USD')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /2026-Q2: \$9,007,199,254,740,993/ }),
    ).toBeTruthy();
    expect(screen.queryByRole('img', { name: /\$9,007,199,254,740,992/ })).toBeNull();
    expect(screen.getByRole('img', { name: /2026-Q2: 1 unspecified/ })).toBeTruthy();
  });
});
