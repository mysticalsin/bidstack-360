import { describe, expect, it } from 'vitest';

import { appDatabaseUrl, ownerDatabaseUrl } from './database-roles.js';

describe('polo database logins', () => {
  it('keeps the app login distinct from the owner and does not echo a secret', () => {
    const fixture = 'fixture-password';
    const owner = new URL(ownerDatabaseUrl());
    const app = new URL(appDatabaseUrl(fixture));

    // WHY: one login for both would let the API delete audit rows.
    expect(owner.username).toBe('bidstack');
    expect(app.username).toBe('app_role');
    expect(app.password).toBe(fixture);
    expect(app.toString()).not.toBe(owner.toString());

    expect(() => appDatabaseUrl('')).toThrow(/^POLO_APP_DB_PASSWORD is required$/);
  });
});
