// A contact's customer word opens the account only through the company id.
// The name is not an address: a search on it can match a different company.
import { describe, expect, it } from 'vitest';

import { contactAccountHref } from './contactAccountHref';

const LINKED = '22222222-2222-4222-8222-222222222222';

describe('contact account href', () => {
  it('opens the account cockpit for a company id', () => {
    // WHY: the contact already stores the company. That id is the account.
    expect(contactAccountHref(LINKED)).toBe(`/accounts/${LINKED}`);
    expect(contactAccountHref(LINKED.toUpperCase())).toBe(`/accounts/${LINKED.toUpperCase()}`);
  });

  it('refuses a name, a script, a path, and a blank', () => {
    // WHY: those values would send the click to a search, another site, or a
    // script. An unlinked contact has no account to open.
    expect(contactAccountHref('Globex')).toBeNull();
    expect(contactAccountHref('Globex Labs')).toBeNull();
    expect(contactAccountHref('javascript:alert(1)')).toBeNull();
    expect(contactAccountHref('../admin')).toBeNull();
    expect(contactAccountHref('https://evil.example/phish')).toBeNull();
    expect(contactAccountHref(`${LINKED}/extra`)).toBeNull();
    expect(contactAccountHref(` ${LINKED}`)).toBeNull();
    expect(contactAccountHref('')).toBeNull();
    expect(contactAccountHref(null)).toBeNull();
    expect(contactAccountHref(undefined)).toBeNull();
  });
});
