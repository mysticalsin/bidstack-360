import { describe, expect, it } from 'vitest';

import { findAllowedUser, parseAllowedUsers } from './allowed-users.js';

describe('POLO_ALLOWED_USERS', () => {
  it('parses email:Role pairs into system roles', () => {
    const users = parseAllowedUsers(
      'Ada.Lovelace@mantu.com:Admin, colleague@amaris.com:Account Executive',
    );
    expect(users).toEqual([
      { email: 'ada.lovelace@mantu.com', role: 'Admin', legacyRole: 'admin' },
      { email: 'colleague@amaris.com', role: 'Account Executive', legacyRole: 'member' },
    ]);
    expect(findAllowedUser('ADA.LOVELACE@mantu.com', users)?.role).toBe('Admin');
  });

  it('rejects unknown roles so a typo cannot mint an implicit admin', () => {
    expect(() => parseAllowedUsers('ada@mantu.com:Superuser')).toThrow(/Invalid POLO_ALLOWED_USERS role/);
  });

  it('rejects a missing role so an email-only entry cannot slip through', () => {
    expect(() => parseAllowedUsers('ada@mantu.com')).toThrow(/Expected email:Role/);
  });
});
