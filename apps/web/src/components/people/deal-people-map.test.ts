import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACCOUNT_PEOPLE_DRAWN } from '@bidstack/shared';

import { accountPeopleCaption, accountPeoplePage } from './account-people-caption';

/**
 * Take the deal people query actually uses. A literal 200 cuts the later
 * person before the caption can tell that the page is not the whole map.
 */
function dealPeopleQueryTake(src: string): number {
  const start = src.indexOf('export async function peopleMapForOpportunity');
  const block = src.slice(start, src.indexOf('async function finishMap'));
  if (block.includes('take: accountPeopleTake()')) return ACCOUNT_PEOPLE_DRAWN + 1;
  const match = block.match(/take:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

describe('deal people map', () => {
  it('does not call two hundred people the whole map when a later person was loaded', () => {
    // WHY: the deal map took two hundred contacts. Cutting a 201st person
    // left "200 people" as if that page were everyone on the deal. One more
    // loaded row means those two hundred are not every person. The extra row
    // is dropped. A shorter map keeps "N people". No person total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/services/people-map.ts'),
      'utf8',
    );
    const rows = Array.from({ length: ACCOUNT_PEOPLE_DRAWN + 1 }, (_, n) => ({
      id: `p${n}`,
      name: n === ACCOUNT_PEOPLE_DRAWN ? 'Probe Person' : `Person ${n}`,
    }));
    const loaded = rows.slice(0, dealPeopleQueryTake(src));
    const page = accountPeoplePage(loaded);
    const caption = accountPeopleCaption(page.people.length, page.pageContinues);
    expect(caption).toBe('200 in the latest 200, not every person');
    expect(caption).not.toBe('200 people');
    expect(caption).not.toBe(`${rows.length} people`);
    expect(caption).not.toMatch(/201|Show all|View all/i);
    expect(page.people).toHaveLength(ACCOUNT_PEOPLE_DRAWN);
    expect(page.people.some((person) => person.name === 'Probe Person')).toBe(false);
    expect(loaded.some((person) => person.name === 'Probe Person')).toBe(true);
    // A continuing page does not turn the drawn length into a coverage total.
    expect(page.pageContinues).toBe(true);

    const shortLoaded = rows.slice(0, 2).slice(0, dealPeopleQueryTake(src));
    const short = accountPeoplePage(shortLoaded);
    expect(short.pageContinues).toBe(false);
    expect(short.people).toHaveLength(2);
    expect(accountPeopleCaption(short.people.length, short.pageContinues)).toBe('2 people');
    expect(accountPeopleCaption(short.people.length, short.pageContinues)).not.toMatch(/not every/i);
    expect(accountPeopleCaption(ACCOUNT_PEOPLE_DRAWN, false)).toBe('200 people');
  });
});
