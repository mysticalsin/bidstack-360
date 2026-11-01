import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WinLossReasonsCard } from './WinLossReasonsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => false,
}));

vi.mock('@/hooks/useWinLoss', () => ({
  useWinLossPatterns: () => ({
    isLoading: false,
    isError: false,
    data: { rows: [], totalWon: 0, totalLost: 0, topLossReason: null },
  }),
  useUpsertWinLoss: () => ({ mutate: vi.fn(), isPending: false }),
}));

afterEach(() => {
  cleanup();
});

describe('WinLossReasonsCard', () => {
  it('does not read zero reason records as zero closed deals', () => {
    // Why: the account can have closed stages while the org has no reason
    // rows. "0 lost recorded" was being read as "this account lost nothing."
    render(
      <WinLossReasonsCard
        closedOpps={[
          { id: 'a', name: 'Legacy app retirement', outcome: 'lost' },
          { id: 'b', name: 'Zero Trust expansion', outcome: 'won' },
        ]}
      />,
    );

    expect(screen.getByText('0 won and 0 lost reason records across the org').textContent).toContain(
      'reason records across the org',
    );
    expect(
      screen.getByText('This account has 2 closed deals. A closed stage is not a reason.').textContent,
    ).toContain('not a reason');
  });
});
