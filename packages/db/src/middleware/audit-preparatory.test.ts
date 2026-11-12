// The revoke migration does not change the user the API connects as.
// app_role has no members. These files have to say that, and R-2 stays open.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

describe('audit delete revoke is preparatory', () => {
  it('says the revoke is not the runtime guarantee and leaves R-2 open', () => {
    const middleware = readFileSync(resolve(here, 'audit-immutability.ts'), 'utf8');
    const migration = readFileSync(
      resolve(here, '../../prisma/migrations/20261112160000_audit_log_app_role_revoke_delete/migration.sql'),
      'utf8',
    );
    const roleTest = readFileSync(
      resolve(root, 'apps/api/src/security/audit-log-delete-role.integration.test.ts'),
      'utf8',
    );
    const threat = readFileSync(resolve(root, 'docs/security/THREAT-MODEL.md'), 'utf8');

    // WHY: the note was removed, so the open follow-up disappeared from the
    // code while the process still connects as the table owner.
    expect(middleware).toContain(
      'Remaining follow-up: REVOKE DELETE ON audit_log from the app role so only the',
    );
    expect(middleware).toContain('preparatory');
    expect(migration.toLowerCase()).toContain('preparatory');
    expect(roleTest).not.toContain('This proves the revoke');
    expect(roleTest.toLowerCase()).toContain('preparatory');

    const stride = threat.split('\n').find((line) => line.includes('Residual Risks R-2'));
    const residual = threat.split('\n').find((line) => line.startsWith('| R-2'));
    expect(stride).toContain('planned');
    expect(residual).toContain('app role today');
    expect(residual?.toLowerCase()).not.toContain('closed');
  });
});
