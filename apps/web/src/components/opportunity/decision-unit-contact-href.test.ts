// The decision-unit link is the contact id. The displayed name is never
// written into the address.
import { describe, expect, it } from 'vitest';

import { decisionUnitContactHref } from './decision-unit-contact-href';

const ADA = '11111111-1111-4111-8111-111111111111';

describe('decision unit contact href', () => {
  it('opens the contact page for a contact id', () => {
    // WHY: the deal already stores the person. That id is the record.
    expect(decisionUnitContactHref(ADA)).toBe(`/contacts/${ADA}`);
    expect(decisionUnitContactHref(ADA.toUpperCase())).toBe(`/contacts/${ADA.toUpperCase()}`);
  });

  it('refuses a name, a script, a path, and a blank', () => {
    // WHY: those values would send the click to a search, another site, or a
    // script. A row without a real contact id has no page to open.
    expect(decisionUnitContactHref('Ada North')).toBeNull();
    expect(decisionUnitContactHref('Northwind Pharma')).toBeNull();
    expect(decisionUnitContactHref('javascript:alert(1)')).toBeNull();
    expect(decisionUnitContactHref('../admin')).toBeNull();
    expect(decisionUnitContactHref('https://evil.example/phish')).toBeNull();
    expect(decisionUnitContactHref(`${ADA}/extra`)).toBeNull();
    expect(decisionUnitContactHref(` ${ADA}`)).toBeNull();
    expect(decisionUnitContactHref('')).toBeNull();
    expect(decisionUnitContactHref(null)).toBeNull();
    expect(decisionUnitContactHref(undefined)).toBeNull();
  });
});
