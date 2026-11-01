import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const page = vi.hoisted(() => ({
  data: undefined as { items: Array<{ id: string; stage: string; value: number; customer: string; dueDate: string | null }>; nextCursor?: string | null } | undefined,
}));

vi.mock('@/hooks/useOpportunityRows', () => ({
  useOpportunityRows: () => page,
  opportunityVizIsPartial: (snapshot: { nextCursor?: string | null } | null | undefined) => Boolean(snapshot?.nextCursor),
}));
vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => ({ data: undefined }),
}));

import { AccountVisuals } from './AccountVisuals';

afterEach(() => {
  cleanup();
  page.data = undefined;
});

describe('AccountVisuals snapshot', () => {
  it('does not call a missing account bid an empty pipeline when the org page continues', () => {
    // WHY: the account chart filters the latest 100 updated bids. Another page can still hold this account.
    page.data = { items: [], nextCursor: 'more' };
    render(
      <MemoryRouter>
        <AccountVisuals companyId="c1" companyName="Acme" />
      </MemoryRouter>,
    );
    expect(screen.getByText('No open bids for this account in the latest 100 updated bids.')).toBeTruthy();
    expect(screen.queryByText('No open bids for this account.')).toBeNull();
  });
});
