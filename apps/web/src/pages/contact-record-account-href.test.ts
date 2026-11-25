// The company on a contact opens its account only through the stored company
// id. The customer name is not an address: a search on it can match a
// different company.
import { describe, expect, it } from 'vitest';

import { contactRecordAccountHref } from './contact-record-account-href';

const SIEMENS = 'c0000000-0000-4000-8000-0000000000aa';

describe('contact record account href', () => {
  it('opens the account for a company id', () => {
    // WHY: the contact already stores this company. That id is the account.
    expect(contactRecordAccountHref(SIEMENS)).toBe(`/accounts/${SIEMENS}`);
    expect(contactRecordAccountHref(SIEMENS.toUpperCase())).toBe(
      `/accounts/${encodeURIComponent(SIEMENS.toUpperCase())}`,
    );
  });

  it('refuses a name, a script, a path, and a blank', () => {
    // WHY: those values would send the click to a search, another site, or a
    // script. A contact without a real company id has no account to open.
    expect(contactRecordAccountHref('Siemens')).toBeNull();
    expect(contactRecordAccountHref('Globex Labs')).toBeNull();
    expect(contactRecordAccountHref('javascript:alert(1)')).toBeNull();
    expect(contactRecordAccountHref('../admin')).toBeNull();
    expect(contactRecordAccountHref('https://evil.example/phish')).toBeNull();
    expect(contactRecordAccountHref(`${SIEMENS}/extra`)).toBeNull();
    expect(contactRecordAccountHref(` ${SIEMENS}`)).toBeNull();
    expect(contactRecordAccountHref('')).toBeNull();
    expect(contactRecordAccountHref(null)).toBeNull();
    expect(contactRecordAccountHref(undefined)).toBeNull();
  });
});
