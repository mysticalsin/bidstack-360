import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenIssuesCard, openIssuesCaption } from './OpenIssuesCard';
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
    useMotionValue: () => ({ get: () => 0, set: () => undefined }),
    animate: () => ({ stop: () => undefined }),
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
    expect(screen.getByText('Latest 50 rows. 3 open risks on the account.')).toBeTruthy();
    expect(screen.queryByText('Nothing recorded')).toBeNull();
  });

  it('shows unranked open risks when the card list is empty', () => {
    // WHY: the buckets waited for a visible row. Three open risks with no
    // rank read as an empty mix.
    render(
      <OpenIssuesCard
        risks={[]}
        compliance={[]}
        openRiskCount={3}
        openRiskSeverity={{ critical: 0, high: 0, medium: 0, low: 0 }}
        risksCapped
      />,
    );
    expect(screen.getByText('Unranked')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('does not draw a zero risk mix for open compliance checks', () => {
    // WHY: the caption counts compliance. Zero risk buckets made those checks
    // look like an empty risk mix.
    render(
      <OpenIssuesCard
        risks={[]}
        compliance={[]}
        openRiskCount={0}
        openComplianceCount={5}
        openRiskSeverity={{ critical: 0, high: 0, medium: 0, low: 0 }}
        complianceCapped
      />,
    );
    expect(screen.getByText('Latest 50 rows. 5 open checks on the account.')).toBeTruthy();
    expect(screen.queryByText('Unranked')).toBeNull();
    expect(screen.queryByText('Critical')).toBeNull();
  });

  it('names open risks and open checks separately', () => {
    // WHY: one combined total did not match the risk buckets under the caption.
    expect(
      openIssuesCaption({ recorded: 2, openRisks: 2, openChecks: 5, pageCapped: true }).text,
    ).toBe('Latest 50 rows. 2 open risks and 5 open checks on the account.');
    expect(
      openIssuesCaption({ recorded: 1, openRisks: 1, openChecks: 0, pageCapped: false }).text,
    ).toBe('1 open risk');
  });

  it('does not mark an unranked risk as low', () => {
    // WHY: a missing severity used to fall through to the low initial.
    expect(severityShort(null)).toBe('–');
    expect(severityShort('low')).toBe('L');
  });
});
