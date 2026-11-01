import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopilotResultView } from './CopilotResultView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/components/ai/ai-feedback', () => ({
  AiFeedback: () => null,
}));

vi.mock('@/components/motion/AnimatedNumber', () => ({
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
}));

afterEach(() => {
  cleanup();
});

const base = {
  sessionId: 's1',
  summary: '7 opportunities on this account, 4 won, 2 lost, 3 linked contacts. No health score was produced.',
  expansionOpportunities: [],
  churnRisks: [],
  costMicros: 0,
};

describe('account intel result', () => {
  it('does not present a missing score as relationship health', () => {
    // Why: the stub used to show 50 / 100 relationship health when Dust
    // returned nothing.
    render(
      <CopilotResultView
        result={{ kind: 'account-intel', data: { ...base, healthScore: null } }}
      />,
    );
    expect(screen.getByText('No health score').textContent).toBe('No health score');
    expect(screen.getByText('No model score was returned').textContent).toContain('No model score');
    expect(screen.queryByText('/ 100 relationship health')).toBeNull();
  });
});
