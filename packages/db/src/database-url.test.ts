import { describe, expect, it } from 'vitest';

import { assertDistinctDatabaseLogins, databaseLogin } from './database-url.js';

describe('database login split', () => {
  it('refuses one login for the app and the owner without repeating the URL', () => {
    const secret = 'fixture-password';
    const app = `postgresql://app_role:${secret}@db.example:5432/bidstack`;
    const owner = `postgresql://bidstack_owner:${secret}@db.example:5432/bidstack`;
    expect(databaseLogin(app)).toBe('app_role');
    expect(databaseLogin(owner)).toBe('bidstack_owner');
    expect(() => assertDistinctDatabaseLogins(app, app)).toThrow(/owner login/);
    try {
      assertDistinctDatabaseLogins(app, app);
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain(secret);
    }
    expect(() => assertDistinctDatabaseLogins(app, owner)).not.toThrow();
  });
});
