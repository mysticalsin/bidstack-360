import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACCOUNT_PEOPLE_DRAWN, accountPeopleTake } from './account-people-page.js';

describe('accountPeopleTake', () => {
  it('loads one row past the people the account map draws', () => {
    // WHY: the account map took two hundred contacts. A later person never
    // arrived, and "200 people" treated that page as the whole account. The
    // extra row is the probe. No person total is invented.
    const rows = Array.from({ length: ACCOUNT_PEOPLE_DRAWN + 1 }, (_, i) => `p${i}`);
    const passed = rows.slice(0, accountPeopleTake());
    expect(passed).toEqual(rows);
    expect(passed).not.toEqual(rows.slice(0, ACCOUNT_PEOPLE_DRAWN));
    expect(passed).toContain('p200');
  });

  it('keeps a shorter list intact', () => {
    // WHY: two people are the whole loaded set. The probe take must not
    // drop one of them.
    const two = ['Ada', 'Bea'];
    expect(two.slice(0, accountPeopleTake())).toEqual(two);
  });

  it('the account people query uses that probe take', () => {
    // WHY: the helper only matters if the company people query calls it. A
    // leftover take of two hundred would cut the later person before the
    // map can say the page is not every person.
    const src = readFileSync(fileURLToPath(new URL('./people-map.ts', import.meta.url)), 'utf8');
    const start = src.indexOf('export async function peopleMapForCompany');
    const block = src.slice(start, src.indexOf('export async function peopleMapForOpportunity'));
    expect(block).toContain('take: accountPeopleTake()');
    expect(block).not.toMatch(/take:\s*200/);
  });
});
