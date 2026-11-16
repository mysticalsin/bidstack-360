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

  it('admits a whole domain with an @domain:Role entry, exact domain only', () => {
    const users = parseAllowedUsers('boss@amaris.com:Admin,@amaris.com:Sales Manager,@MANTU.com:Sales Manager');
    expect(findAllowedUser('Boss@amaris.com', users)).toEqual({
      email: 'boss@amaris.com',
      role: 'Admin',
      legacyRole: 'admin',
    });
    expect(findAllowedUser('T.Massin@Amaris.com', users)).toEqual({
      email: 't.massin@amaris.com',
      role: 'Sales Manager',
      legacyRole: 'manager',
    });
    expect(findAllowedUser('someone@mantu.com', users)?.role).toBe('Sales Manager');
    expect(findAllowedUser('x@evil-amaris.com', users)).toBeUndefined();
    expect(findAllowedUser('x@amaris.com.evil.io', users)).toBeUndefined();
    expect(findAllowedUser('x@sub.amaris.com', users)).toBeUndefined();
    expect(findAllowedUser('@amaris.com', users)).toBeUndefined();
  });

  it('rejects a malformed domain entry', () => {
    expect(() => parseAllowedUsers('@:Sales Manager')).toThrow(/Invalid POLO_ALLOWED_USERS email/);
    expect(() => parseAllowedUsers('@amaris:Sales Manager')).toThrow(/Invalid POLO_ALLOWED_USERS email/);
    expect(() => parseAllowedUsers('@a@b.com:Sales Manager')).toThrow(/Invalid POLO_ALLOWED_USERS email/);
  });
});
