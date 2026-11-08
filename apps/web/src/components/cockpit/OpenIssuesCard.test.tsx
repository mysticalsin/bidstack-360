import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import { OpenIssuesCard } from './OpenIssuesCard';

describe('OpenIssuesCard', () => {
  afterEach(cleanup);

  it('says nothing is recorded, not that everything is green, when an account has no rows', () => {
    render(<OpenIssuesCard risks={[]} compliance={[]} />);
    expect(screen.getByText('No open issues')).toBeDefined();
    expect(
      screen.getByText('No risks or compliance checks are recorded for this account yet.'),
    ).toBeDefined();
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
  });
});
