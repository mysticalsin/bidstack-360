import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenIssuesCard } from './OpenIssuesCard';
import { severityShort } from './_tokens';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    motion: {
      div: ({ children, ...props }: { children?: React.ReactNode }) =>
        React.createElement('div', props, children),
    },
    useReducedMotion: () => true,
  };
});

afterEach(() => {
  cleanup();
});

describe('OpenIssuesCard', () => {
  it('does not treat a missing register as an all-clear', () => {
    // Why: an empty risk list used to say the account was green. Absence of
    // rows is not a recorded clearance.
    render(<OpenIssuesCard risks={[]} compliance={[]} />);

    expect(screen.getByText('Nothing recorded').textContent).toBe('Nothing recorded');
    expect(screen.getByText(/not a clearance/).textContent).toContain('not a clearance');
    expect(screen.queryByText('Everything is green here.')).toBeNull();
    expect(screen.queryByText('All clear')).toBeNull();
  });

  it('does not call a full page of closed rows an empty register', () => {
    // WHY: status order loaded mitigated rows first, so an open risk past 50 read as none open.
    render(
      <OpenIssuesCard
        risks={[]}
        compliance={[]}
        openRiskCount={3}
        risksCapped
      />,
    );
    expect(screen.getByText('Latest 50 rows. 3 open items on the account.')).toBeTruthy();
    expect(screen.queryByText('Nothing recorded')).toBeNull();
  });

  it('does not mark an unranked risk as low', () => {
    // WHY: a missing severity used to fall through to the low initial.
    expect(severityShort(null)).toBe('–');
    expect(severityShort('low')).toBe('L');
  });
});
