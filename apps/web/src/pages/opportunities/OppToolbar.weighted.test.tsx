import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Opportunity } from '@bidstack/shared';
import type { OrgSummary } from '@/hooks/useOrgSummary';

import { OppKpiBar } from './OppToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) => {
      if (!vars) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => String(vars[key] ?? ''));
    },
  }),
}));

const summary = {
  companies: 0,
  contacts: 0,
  leads: 0,
  opportunities: 19,
  openOpportunities: 7,
  pipelineValue: 12_015_000,
  tasks: 0,
  overdueTasks: 0,
  serviceCases: 0,
  openServiceCases: 0,
  recentActivity: [],
} satisfies OrgSummary;

afterEach(cleanup);

describe('OppKpiBar weighted tile', () => {
  it('names the page figure as value times stored stage probability', () => {
    // Why: the tile used to say WR, which reads as a win rate, and it mixed closed rows.
    const open = { value: 100, probability: 40, pipelineStage: null, stage: 's2_sent' } as Opportunity;
    const won = {
      value: 1_000_000,
      probability: 100,
      stage: 'closed_won',
      pipelineStage: { isWon: true, isLost: false },
    } as Opportunity;
    // A lost row with no stage relation used to stay in the open weighted sum.
    const lost = {
      value: 500,
      probability: 80,
      stage: 'closed_lost',
      pipelineStage: null,
    } as Opportunity;

    render(<OppKpiBar opps={[open, won, lost]} summary={summary} />);

    expect(screen.getByText('Weighted (page)')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText(/Open rows on this page × stored probability/)).toBeTruthy();
    expect(screen.queryByText(/WR/)).toBeNull();
  });

  it('prints the open pipeline from integer micros', () => {
    // WHY: Number(sum) / 1e6 moved this portfolio total to the next cent.
    render(
      <OppKpiBar
        opps={[]}
        summary={{ ...summary, pipelineValueMicros: '8598204328457184962' }}
      />,
    );
    expect(screen.getByText('8,598,204,328,457.18')).toBeTruthy();
    expect(screen.queryByText(/457\.19/)).toBeNull();
  });

  it('weights a large page amount from integer micros', () => {
    // WHY: value × probability in JS numbers moved this page total off the cent.
    const open = {
      value: 0,
      valueMicros: '8598204328457184962',
      probability: 100,
      pipelineStage: null,
      stage: 's2_sent',
    } as Opportunity;
    render(<OppKpiBar opps={[open]} summary={summary} />);
    expect(screen.getByText('8,598,204,328,457.18')).toBeTruthy();
  });
});
