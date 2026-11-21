import { describe, expect, it } from 'vitest';

import { findAllowedUser, parseAllowedUsers } from './allowed-users.js';

describe('POLO_ALLOWED_USERS', () => {
  it('parses email:Role pairs into system roles', () => {
    const users = parseAllowedUsers(
      'Alex.Example@example.test:Admin, colleague@example.com:Account Executive',
    );
    expect(users).toEqual([
      { email: 'alex.example@example.test', role: 'Admin', legacyRole: 'admin' },
      { email: 'colleague@example.com', role: 'Account Executive', legacyRole: 'member' },
    ]);
    expect(findAllowedUser('ALEX.EXAMPLE@example.test', users)?.role).toBe('Admin');
  });

  it('rejects unknown roles so a typo cannot mint an implicit admin', () => {
    expect(() => parseAllowedUsers('ada@example.test:Superuser')).toThrow(/Invalid POLO_ALLOWED_USERS role/);
  });

  it('rejects a missing role so an email-only entry cannot slip through', () => {
    expect(() => parseAllowedUsers('ada@example.test')).toThrow(/Expected email:Role/);
  });

  it('admits a whole domain with an @domain:Role entry, exact domain only', () => {
    const users = parseAllowedUsers('boss@example.com:Admin,@example.com:Sales Manager,@example.test:Sales Manager');
    expect(findAllowedUser('Boss@example.com', users)).toEqual({
      email: 'boss@example.com',
      role: 'Admin',
      legacyRole: 'admin',
    });
    expect(findAllowedUser('A.Sample@Example.com', users)).toEqual({
      email: 'a.sample@example.com',
      role: 'Sales Manager',
      legacyRole: 'manager',
    });
    expect(findAllowedUser('someone@example.test', users)?.role).toBe('Sales Manager');
    expect(findAllowedUser('x@not-example.test', users)).toBeUndefined();
    expect(findAllowedUser('x@example.com.invalid', users)).toBeUndefined();
    expect(findAllowedUser('x@sub.example.com', users)).toBeUndefined();
    expect(findAllowedUser('@example.com', users)).toBeUndefined();
  });

  it('rejects a malformed domain entry', () => {
    expect(() => parseAllowedUsers('@:Sales Manager')).toThrow(/Invalid POLO_ALLOWED_USERS email/);
    expect(() => parseAllowedUsers('@nodot:Sales Manager')).toThrow(/Invalid POLO_ALLOWED_USERS email/);
    expect(() => parseAllowedUsers('@a@b.com:Sales Manager')).toThrow(/Invalid POLO_ALLOWED_USERS email/);
  });
});
