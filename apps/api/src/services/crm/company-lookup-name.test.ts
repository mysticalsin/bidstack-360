import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { lookupNamesMatch } from './company-lookup-name.js';

describe('registry lookup names', () => {
  it('does not link a company because the shorter name sits inside the longer one', () => {
    // WHY: lookup treated one name as the other when every core word of the
    // shorter name appeared in the longer one. MAPFRE then resolved to
    // MAPFRE Malta, and a typed prefix resolved to a different account.
    // Legal suffixes still match. An extra word does not.
    expect(lookupNamesMatch('DNB Bank', 'DNB BANK ASA')).toBe(true);
    expect(lookupNamesMatch('MAPFRE', 'MAPFRE S.A.')).toBe(true);
    expect(lookupNamesMatch('NOS', 'NOS, SGPS, S.A.')).toBe(true);
    expect(lookupNamesMatch('CI Financial', 'CI Financial Corp.')).toBe(true);
    expect(lookupNamesMatch('MAPFRE', 'MAPFRE MALTA P.L.C.')).toBe(false);
    expect(lookupNamesMatch('MAPFRE MALTA', 'MAPFRE S.A.')).toBe(false);
    expect(lookupNamesMatch('Acme', 'Acme Staffing')).toBe(false);
    expect(lookupNamesMatch('Acme Staffing', 'Acme Corp')).toBe(false);
    expect(lookupNamesMatch('Mant', 'Mantu')).toBe(false);
    expect(lookupNamesMatch('Acme', 'Acme')).toBe(true);
    expect(lookupNamesMatch('', 'Acme')).toBe(false);
    expect(lookupNamesMatch('Rush University System for Health', 'RUSH ENTERPRISES INC')).toBe(
      false,
    );
  });

  it('does not keep the contained-name check in the lookup route', () => {
    const src = readFileSync(new URL('../../routes/crm/companies.ts', import.meta.url), 'utf8');
    const start = src.indexOf("'/crm/companies/lookup'");
    const end = src.indexOf("'/crm/companies/:id'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    // Substring containment is the query that attached MAPFRE Malta.
    expect(body).toContain('lookupNamesMatch');
    expect(body).not.toContain('.includes(name)');
    expect(body).not.toContain('.has(');
  });
});
