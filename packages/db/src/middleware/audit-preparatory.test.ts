// The 20261112160000 migration only recorded grants. 20261112180000 is the
// runtime revoke. R-2 is closed for the app role, with the cascade and the
// undeployed owner URL still named.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

describe('audit delete revoke is the app role', () => {
  it('names the runtime revoke and what is still left of R-2', () => {
    const middleware = readFileSync(resolve(here, 'audit-immutability.ts'), 'utf8');
    const recorded = readFileSync(
      resolve(here, '../../prisma/migrations/20261112160000_audit_log_app_role_revoke_delete/migration.sql'),
      'utf8',
    );
    const runtime = readFileSync(
      resolve(here, '../../prisma/migrations/20261112180000_audit_log_app_role_runtime/migration.sql'),
      'utf8',
    );
    const threat = readFileSync(resolve(root, 'docs/security/THREAT-MODEL.md'), 'utf8');

    // WHY: the earlier note said the process still connected as the table
    // owner. The runtime migration is the guarantee, and the leftover paths
    // have to stay written down.
    expect(recorded.toLowerCase()).toContain('preparatory');
    expect(middleware).not.toContain('Remaining follow-up');
    expect(middleware).toContain('deleting an org still cascades');
    expect(runtime).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log FROM app_role',
    );
    expect(runtime).not.toMatch(/PASSWORD\s+'/i);

    const stride = threat.split('\n').find((line) => line.includes('Residual Risks R-2'));
    const residual = threat.split('\n').find((line) => line.startsWith('| R-2'));
    expect(stride).not.toContain('planned');
    expect(residual).toContain('Closed for the app role');
    expect(residual).toContain('cascades');
    expect(residual).not.toContain('app role today');
  });
});
