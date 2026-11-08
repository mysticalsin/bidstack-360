import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PipelineOpenChart } from './PipelineOpenChart';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (key === 'pipeline.stageDealCount_one') return `${values?.count} deal`;
      if (key === 'pipeline.stageDealCount_other') return `${values?.count} deals`;
      return fallback;
    },
  }),
}));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
}));

describe('PipelineOpenChart', () => {
  afterEach(cleanup);

  it('draws the open book and leaves closed outcomes off the bars', () => {
    // WHY: a later column is not evidence a deal advanced, and won or lost
    // value is not open pipeline. The chart is the recorded open stages.
    render(
      <PipelineOpenChart
        stages={[
          { stage: 's3_technical_iteration', count: 1, valueSum: 1_240_000 },
          { stage: 'closed_won', count: 8, valueSum: 7_860_000 },
          { stage: 'closed_lost', count: 4, valueSum: 3_660_000 },
          { stage: 's1_lead', count: 2, valueSum: 125_000 },
        ]}
      />,
    );

    const chart = screen.getByRole('img');
    expect(chart.getAttribute('aria-label')).toMatch(/S3 Technical Iteration/);
    expect(chart.getAttribute('aria-label')).toMatch(/S1 Lead/);
    expect(chart.getAttribute('aria-label')).not.toMatch(/Closed Won|Closed Lost/);
    expect(chart.textContent).toMatch(/1 deal/);
    expect(chart.textContent).toMatch(/2 deals/);
    expect(chart.textContent).not.toMatch(/7\.86M|3\.66M/);
  });
});
