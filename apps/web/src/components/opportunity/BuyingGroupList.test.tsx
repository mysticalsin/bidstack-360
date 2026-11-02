import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACCOUNT_PEOPLE_DRAWN, type PeopleMapPerson } from '@bidstack/shared';

import { BuyingGroupList } from './BuyingGroupList';

const state: { people: PeopleMapPerson[] } = { people: [] };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
}));

vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => ({
    data: { people: state.people, companyId: 'c1', opportunityId: 'opp-1' },
    isLoading: false,
    isSuccess: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
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

describe('BuyingGroupList', () => {
  it('drops a later person and does not call the drawn page the whole deal map', () => {
    // WHY: the deal map took two hundred links. A 201st person must not be
    // drawn, and the caption must not say those 200 are every person. Two
    // people keep the old wording. No person total is invented.
    state.people = Array.from({ length: ACCOUNT_PEOPLE_DRAWN + 1 }, (_, n) =>
      person(n === ACCOUNT_PEOPLE_DRAWN ? 'Probe Person' : `Person ${n}`),
    );
    const { unmount } = render(<BuyingGroupList opportunityId="opp-1" />);
    expect(screen.getByText('200 in the latest 200, not every person')).toBeTruthy();
    expect(screen.queryByText('Probe Person')).toBeNull();
    expect(screen.queryByText('200 people')).toBeNull();
    expect(screen.queryByText(/201/)).toBeNull();
    expect(screen.getByText('Person 0')).toBeTruthy();
    expect(screen.getByText(`Person ${ACCOUNT_PEOPLE_DRAWN - 1}`)).toBeTruthy();
    unmount();

    state.people = [person('Ada'), person('Bea')];
    render(<BuyingGroupList opportunityId="opp-1" />);
    expect(
      screen.getByText(
        'People already linked to this opportunity. Unknown means no accepted evidence. Needs review means a note we would not attach. Evidenced means a person accepted the link.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('Bea')).toBeTruthy();
    expect(screen.queryByText(/not every/i)).toBeNull();
  });
});
