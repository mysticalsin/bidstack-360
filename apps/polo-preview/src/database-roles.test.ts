import { describe, expect, it } from 'vitest';

import { appDatabaseUrl, appRoleGrantsSql, ensureAppRoleSql, ownerDatabaseUrl } from './database-roles.js';

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

  it('creates the app login before a restored dump is asked for a password', () => {
    const sql = ensureAppRoleSql();
    // WHY: pg_dump restores tables, not roles. ALTER ROLE then fails and the
    // preview stays on "Polo is starting".
    expect(sql).toContain('CREATE ROLE app_role LOGIN');
    expect(sql).toContain("rolname = 'app_role'");
    expect(sql).not.toMatch(/PASSWORD/i);
  });

  it('gives the restored login table rights without audit delete', () => {
    const sql = appRoleGrantsSql();
    // WHY: grants in the dump are skipped when the role did not exist yet.
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role');
    expect(sql).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log FROM app_role');
    expect(sql).toContain('GRANT SELECT, INSERT ON TABLE public.audit_log TO app_role');
  });
});
