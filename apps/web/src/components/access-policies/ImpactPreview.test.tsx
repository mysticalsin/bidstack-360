import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(vars?.[n] ?? '')),
  }),
}));

import type { AccessPolicySimulation } from '@/hooks/useAccessPolicies';

import { ImpactPreview } from './ImpactPreview';

const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];

const RESULT: AccessPolicySimulation = {
  window: { from: '2026-10-31T18:00:00.000Z', to: '2026-11-07T18:00:00.000Z' },
  evaluated: 5,
  baselineVersion: null,
  gained: { count: 1, users: [{ userId: 'u2', name: 'Ana Diaz', count: 1 }], examples: [] },
  lost: {
    count: 2,
    users: [{ userId: 'u1', name: 'Fran Seller', count: 2 }],
    examples: [
      {
        at: '2026-11-06T10:00:00.000Z',
        userId: 'u1',
        userName: 'Fran Seller',
        action: 'companies:write',
        resource: 'companies',
        targetId: 'c-de',
        ruleId: 'no-de-writes',
      },
    ],
  },
  byDay: DAYS.map((day, i) => ({ day, gained: i === 6 ? 1 : 0, lost: i === 5 ? 2 : 0 })),
};

afterEach(() => {
  cleanup();
});

describe('ImpactPreview', () => {
  it('runs the simulation on demand', () => {
    const onRun = vi.fn();
    render(<ImpactPreview result={null} onRun={onRun} running={false} />);
    expect(screen.getByText('Run a simulation to see who gains or loses access over the last 7 days.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('shows counts, people and examples for gains and losses', () => {
    render(<ImpactPreview result={RESULT} onRun={vi.fn()} running={false} />);
    expect(screen.getByText('2 lose access')).toBeTruthy();
    expect(screen.getByText('1 gains access')).toBeTruthy();
    expect(screen.getByText('Across 5 audit events in the last 7 days.')).toBeTruthy();
    const lost = screen.getByRole('region', { name: 'Loses access' });
    expect(within(lost).getByText('Fran Seller')).toBeTruthy();
    expect(within(lost).getByText(/companies:write on Companies/)).toBeTruthy();
    expect(within(lost).getByText(/no-de-writes/)).toBeTruthy();
  });

  it('offers the daily chart as a table', () => {
    render(<ImpactPreview result={RESULT} onRun={vi.fn()} running={false} />);
    expect(screen.getByRole('img', { name: /Daily access changes/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table', { name: 'Daily access changes' });
    expect(within(table).getAllByRole('row')).toHaveLength(8);
  });

  it('says so in one sentence when nothing changes', () => {
    render(
      <ImpactPreview
        result={{ ...RESULT, gained: { count: 0, users: [], examples: [] }, lost: { count: 0, users: [], examples: [] } }}
        onRun={vi.fn()}
        running={false}
      />,
    );
    expect(screen.getByText('No one gains or loses access over the last 7 days.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Loses access' })).toBeNull();
  });
});
