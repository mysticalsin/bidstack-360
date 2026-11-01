import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PipelineMetricStrip } from './PipelineMetricStrip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (key === 'pipeline.figuresLoading') return 'Loading the pipeline';
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

describe('PipelineMetricStrip', () => {
  afterEach(cleanup);

  it('shows the open book and leaves closed value out of the open card', () => {
    // WHY: the home figures and the stage chart have to be the same book.
    // A closed amount must not sit under Open pipeline.
    render(
      <PipelineMetricStrip
        stages={[
          { stage: 's3_technical_iteration', count: 1, valueSum: 1_240_000 },
          { stage: 'closed_won', count: 8, valueSum: 7_860_000 },
          { stage: 'closed_lost', count: 4, valueSum: 3_660_000 },
        ]}
      />,
    );

    const open = screen.getByLabelText(/Open pipeline/);
    expect(open.getAttribute('aria-label')).toMatch(/1\.24M unspecified/);
    expect(open.getAttribute('aria-label')).not.toMatch(/7\.86M|3\.66M/);
    expect(screen.getByLabelText(/Won/).getAttribute('aria-label')).toMatch(/7\.86M/);
    expect(screen.getByLabelText(/Won/).getAttribute('aria-label')).toMatch(/currency not recorded/);
    expect(screen.getByLabelText(/Lost/).getAttribute('aria-label')).toMatch(/3\.66M/);
    expect(screen.getByLabelText(/Win rate/).textContent).toMatch(/67%/);
  });

  it('prints the open total from micros when the unit numbers collapse', () => {
    // WHY: the open card added valueSum. That sum reads one unit low.
    const smaller = (9007199254740992n * 1_000_000n).toString();
    const larger = (9007199254740993n * 1_000_000n).toString();
    const collapsed = Number(9007199254740993n);
    render(
      <PipelineMetricStrip
        stages={[
          { stage: 'proposal', count: 1, valueSum: collapsed, valueSumMicros: smaller },
          { stage: 'negotiation', count: 1, valueSum: collapsed, valueSumMicros: larger },
        ]}
      />,
    );

    const open = screen.getByLabelText(/Open pipeline/);
    expect(open.getAttribute('aria-label')).toMatch(/18,014,398,509,481,985/);
    expect(open.getAttribute('aria-label')).not.toMatch(/18,014,398,509,481,984/);
  });

  it('shows the thinking mark while the figures are still loading', () => {
    render(<PipelineMetricStrip stages={undefined} loading />);
    expect(screen.getByRole('status').textContent).toMatch(/Loading the pipeline/);
  });
});