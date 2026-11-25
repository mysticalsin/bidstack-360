// Workspace search prints a contact or lead email on the row, then searches
// only name, role, and company. Pasting Klaus Vogt's address
// (klaus.vogt.<namespace>@example.com) or Hannah Berg's
// (hannah.berg.<namespace>@example.com) matches nothing. contains on email
// or phone throws in the PII middleware and 500s the request, so a fragment
// must stay off those columns.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fullSearchAddress, textOrAddressWhere } from './search-address.js';

const KLAUS = 'klaus.vogt.demo@example.com';
const HANNAH = 'hannah.berg.demo@example.com';

function flat(where: object): string {
  return JSON.stringify(where);
}

describe('workspace search address', () => {
  it('treats the whole query as an address only when it is one', () => {
    // WHY: the demo row prints a full address. A fragment, a phone, or a
    // name is not an equality lookup.
    expect(fullSearchAddress(`  ${KLAUS.toUpperCase()}  `)).toBe(KLAUS.toUpperCase());
    expect(fullSearchAddress(HANNAH)).toBe(HANNAH);
    expect(fullSearchAddress('vogt@')).toBeNull();
    expect(fullSearchAddress('klaus.vogt')).toBeNull();
    expect(fullSearchAddress('Klaus Vogt')).toBeNull();
    expect(fullSearchAddress('+49 30 1234 5670')).toBeNull();
    expect(fullSearchAddress(`${KLAUS} Siemens`)).toBeNull();
  });

  it('finds Klaus Vogt by the address on the row, not by a fragment or a phone', () => {
    // WHY: name and role contains of the whole address miss "Klaus Vogt" /
    // "VP Operations". Equality is the lookup the encryption middleware allows.
    // The plaintext contains stays as the other branch and must not be on email.
    expect(textOrAddressWhere(['name', 'role'], KLAUS.toUpperCase())).toEqual({
      OR: [
        {
          AND: [
            {
              OR: [
                { name: { contains: KLAUS, mode: 'insensitive' } },
                { role: { contains: KLAUS, mode: 'insensitive' } },
              ],
            },
          ],
        },
        { email: { equals: KLAUS.toUpperCase(), mode: 'insensitive' } },
      ],
    });

    const fragment = flat(textOrAddressWhere(['name', 'role'], 'vogt@'));
    expect(fragment).not.toContain('email');
    expect(fragment).not.toContain('phone');
    expect(fragment).toContain('"contains":"vogt@"');

    const phone = flat(textOrAddressWhere(['name', 'role'], '+49 30 1234 5670'));
    expect(phone).not.toContain('email');
    expect(phone).not.toContain('phone');
  });

  it('finds Hannah Berg by her lead address and still matches a name on plaintext columns', () => {
    // WHY: a lead row prints the same shape of address, and "Hannah Berg"
    // must keep matching first and last name without touching email.
    expect(textOrAddressWhere(['firstName', 'lastName', 'companyName'], HANNAH)).toEqual({
      OR: [
        {
          AND: [
            {
              OR: [
                { firstName: { contains: HANNAH, mode: 'insensitive' } },
                { lastName: { contains: HANNAH, mode: 'insensitive' } },
                { companyName: { contains: HANNAH, mode: 'insensitive' } },
              ],
            },
          ],
        },
        { email: { equals: HANNAH, mode: 'insensitive' } },
      ],
    });

    expect(textOrAddressWhere(['name', 'role'], 'Klaus Vogt')).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: 'klaus', mode: 'insensitive' } },
            { role: { contains: 'klaus', mode: 'insensitive' } },
          ],
        },
        {
          OR: [
            { name: { contains: 'vogt', mode: 'insensitive' } },
            { role: { contains: 'vogt', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });

  it('the search route uses that filter for contacts and leads', () => {
    // WHY: a helper that the route does not call still returns an empty page
    // for the address on the row. contains on email would 500 the search.
    const src = readFileSync(new URL('../routes/search.ts', import.meta.url), 'utf8');
    expect(src).toContain("textOrAddressWhere(['name', 'role'], q)");
    expect(src).toContain(
      "textOrAddressWhere(['firstName', 'lastName', 'companyName'], q)",
    );
    expect(src).not.toMatch(/email:\s*\{\s*contains/);
    expect(src).not.toMatch(/phone:\s*\{\s*contains/);
  });
});
