import { describe, expect, it } from 'vitest';

import { contactAccountHref } from './contact-account-href';

const CI_FINANCIAL = 'c0000000-0000-4000-8000-000000000001';

describe('contactAccountHref', () => {
  it('opens the account the contact already stores', () => {
    expect(contactAccountHref(CI_FINANCIAL)).toBe(`/accounts/${CI_FINANCIAL}`);
  });

  it('stays off a name search when the contact has no company id', () => {
    expect(contactAccountHref(null)).toBeNull();
    expect(contactAccountHref(undefined)).toBeNull();
    expect(contactAccountHref('')).toBeNull();
    expect(contactAccountHref('CI Financial')).toBeNull();
    expect(contactAccountHref(`${CI_FINANCIAL}/../companies`)).toBeNull();
  });
});
