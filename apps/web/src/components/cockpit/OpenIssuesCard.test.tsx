import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RiskItem } from '@bidstack/shared';

import { OpenIssuesCard } from './OpenIssuesCard';
import { severityShort } from './_tokens';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
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

  it('does not mark an unranked risk as low', () => {
    // WHY: a missing severity used to fall through to the low initial.
    expect(severityShort(null)).toBe('–');
    expect(severityShort('low')).toBe('L');
  });

  it('does not describe a short risk slice as the whole register', () => {
    // WHY: six mitigated rows used to say the recorded register had no open
    // risks. One more row means that page is not every risk. Six that match
    // the loaded set keep the old wording.
    const mitigated = (id: string): RiskItem => ({
      id,
      title: id,
      severity: 'low',
      owner: null,
      mitigation: null,
      dueDate: null,
      status: 'mitigated',
    });
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(mitigated);

    const { unmount } = render(<OpenIssuesCard risks={six} compliance={[]} risksTruncated />);
    expect(screen.getAllByText('6 in the latest 6, not every risk').length).toBeGreaterThan(0);
    expect(screen.queryByText('No open items in the recorded register')).toBeNull();
    expect(screen.queryByText(/recorded register/i)).toBeNull();
    unmount();

    render(<OpenIssuesCard risks={six} compliance={[]} />);
    expect(screen.getByText('No open items in the recorded register')).toBeTruthy();
    expect(
      screen.getByText('The recorded register has no open risks or compliance checks.'),
    ).toBeTruthy();
    expect(screen.queryByText(/not every risk/i)).toBeNull();
  });
});
