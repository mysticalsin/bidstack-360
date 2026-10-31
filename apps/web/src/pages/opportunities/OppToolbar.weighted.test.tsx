import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

describe('OppKpiBar weighted tile', () => {
  it('names the page figure as value times stored stage probability', () => {
    // Why: the tile used to say WR, which reads as a win rate, and it mixed closed rows.
    const open = { value: 100, probability: 40, pipelineStage: null } as Opportunity;
    const won = {
      value: 1_000_000,
      probability: 100,
      pipelineStage: { isWon: true, isLost: false },
    } as Opportunity;

    render(<OppKpiBar opps={[open, won]} summary={summary} />);

    expect(screen.getByText('Weighted (page)')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText(/Open rows on this page × stored stage probability/)).toBeTruthy();
    expect(screen.queryByText(/WR/)).toBeNull();
  });
});
