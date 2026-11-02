import { describe, expect, it } from 'vitest';

import { ACCOUNT_PEOPLE_DRAWN } from '@bidstack/shared';

import {
  accountPeopleCaption,
  accountPeopleMapMeta,
  accountPeoplePage,
} from './account-people-caption';

describe('account people page', () => {
  it('does not call the loaded people every person when another row was loaded', () => {
    // WHY: the account map drew two hundred and "200 people" treated that
    // page as the whole account. One more loaded row means those two hundred
    // are not every person. Two that fit keep "2 people". No person total
    // is invented.
    const source = Array.from({ length: ACCOUNT_PEOPLE_DRAWN + 1 }, (_, n) => ({
      id: `p${n}`,
      name: n === ACCOUNT_PEOPLE_DRAWN ? 'Probe Person' : `Person ${n}`,
    }));
    const page = accountPeoplePage(source);
    expect(page.people).toHaveLength(ACCOUNT_PEOPLE_DRAWN);
    expect(page.people.some((person) => person.name === 'Probe Person')).toBe(false);
    expect(page.pageContinues).toBe(true);
    const caption = accountPeopleCaption(page.people.length, page.pageContinues);
    expect(caption).toBe('200 in the latest 200, not every person');
    expect(caption).not.toBe(`${source.length} people`);
    expect(caption).not.toBe('200 people');
    expect(caption).not.toMatch(/Show all|View all/i);
    expect(accountPeopleMapMeta(page.people.length, page.pageContinues, 4)).toBe(caption);
    expect(accountPeopleMapMeta(page.people.length, page.pageContinues, 4)).not.toMatch(/201/);

    const short = accountPeoplePage(source.slice(0, 2));
    expect(short.pageContinues).toBe(false);
    expect(short.people).toHaveLength(2);
    expect(accountPeopleCaption(short.people.length, short.pageContinues)).toBe('2 people');
    expect(accountPeopleCaption(short.people.length, short.pageContinues)).not.toMatch(/not every/i);
    expect(accountPeopleMapMeta(2, false, 1)).toBe('2 people · 1 reporting line');
    expect(accountPeopleMapMeta(2, false, 0)).toBe('2 people · 0 reporting lines');
    expect(accountPeopleCaption(ACCOUNT_PEOPLE_DRAWN, false)).toBe('200 people');
  });
});
