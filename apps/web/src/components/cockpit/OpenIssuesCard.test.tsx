import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import { OpenIssuesCard } from './OpenIssuesCard';

describe('OpenIssuesCard', () => {
  afterEach(cleanup);

  it('says nothing is recorded, not that everything is green, when an account has no rows', () => {
    // WHY: demo accounts have no risk or compliance rows. The caption used to
    // say "All clear", which reads as a healthy register. An empty file is
    // not a clean bill of health.
    render(<OpenIssuesCard risks={[]} compliance={[]} />);
    expect(screen.getByText('No open issues')).toBeDefined();
    expect(
      screen.getByText('No risks or compliance checks are recorded for this account yet.'),
    ).toBeDefined();
    expect(screen.getByText('Nothing recorded')).toBeDefined();
    expect(screen.queryByText('All clear')).toBeNull();
  });

  it('says a closed register is closed, not that nothing was recorded', () => {
    // WHY: a mitigated risk is still on the account. The empty list must not
    // claim the file is blank, and it must not put that closed row back on
    // the action list.
    render(
      <OpenIssuesCard
        risks={[
          {
            id: 'r-closed',
            title: 'Archive the brief',
            severity: 'high',
            owner: 'Ana',
            mitigation: null,
            dueDate: null,
            status: 'mitigated',
          } as never,
        ]}
        compliance={[]}
      />,
    );
    expect(screen.getByText('All clear')).toBeDefined();
    expect(screen.getByText('Recorded risks and checks are closed.')).toBeDefined();
    expect(
      screen.queryByText('No risks or compliance checks are recorded for this account yet.'),
    ).toBeNull();
    expect(screen.queryByText('Archive the brief')).toBeNull();
    expect(screen.queryByText('Nothing recorded')).toBeNull();
  });

  it('shows full severity words and the compliance label on rows', () => {
    render(
      <OpenIssuesCard
        risks={[
          { id: 'r1', title: 'Budget freeze', severity: 'high', owner: 'Ana', mitigation: null, dueDate: null, status: 'open' } as never,
        ]}
        compliance={[{ id: 'c1', label: 'DPA unsigned', status: 'blocked', owner: null } as never]}
      />,
    );
    expect(screen.getByText('High', { selector: '.oi-count' })).toBeDefined();
    expect(screen.getByText('Compliance', { selector: '.oi-count' })).toBeDefined();
    expect(screen.getByText('2 items to action')).toBeDefined();
    expect(screen.queryByText('Nothing recorded')).toBeNull();
    expect(screen.queryByText('All clear')).toBeNull();
  });
});
