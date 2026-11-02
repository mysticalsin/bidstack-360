import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACCOUNT_PEOPLE_DRAWN, type PeopleMapPerson } from '@bidstack/shared';

import { AccountPeopleSection } from './AccountPeopleSection';

const state: { people: PeopleMapPerson[] } = { people: [] };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, string | number>) => {
      if (!opts) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(opts[key] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => ({
    data: { people: state.people, companyId: 'c1', opportunityId: null },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAccountWork: () => ({
    data: { commitments: [], internalTasks: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreatePersonFact: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useDecidePersonFact: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateCommitment: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

function person(name: string): PeopleMapPerson {
  return {
    id: name,
    name,
    title: null,
    standing: 'unknown',
    reportsToContactId: null,
    reportsToName: null,
    dealLinks: [],
    facts: [],
  };
}

afterEach(() => {
  cleanup();
  state.people = [];
});

describe('AccountPeopleSection', () => {
  it('says the drawn people are not every person when a later row was loaded', () => {
    // WHY: a take of 200 made "200 unknown" read as the people on the account.
    // The extra source row is dropped. The caption must not print 201, or call
    // the drawn 200 the whole set. Two people keep the coverage sentence.
    state.people = Array.from({ length: ACCOUNT_PEOPLE_DRAWN + 1 }, (_, n) =>
      person(n === ACCOUNT_PEOPLE_DRAWN ? 'Probe Person' : `Person ${n}`),
    );
    const { unmount } = render(<AccountPeopleSection companyId="c1" deals={[]} />);
    expect(screen.getByTestId('account-people-caption').textContent).toBe(
      '200 in the latest 200, not every person',
    );
    expect(screen.queryByText('Probe Person')).toBeNull();
    expect(screen.queryByText(/201 people/)).toBeNull();
    expect(screen.queryByText('200 people')).toBeNull();
    expect(screen.queryByText(/Show all|View all/i)).toBeNull();
    unmount();

    state.people = [person('Ada'), person('Bea')];
    render(<AccountPeopleSection companyId="c1" deals={[]} />);
    expect(screen.getByTestId('account-people-caption').textContent).toBe(
      '2 unknown. Coverage is a count, not a score.',
    );
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Bea' })).toBeTruthy();
    expect(screen.queryByText(/not every/i)).toBeNull();
  });
});
