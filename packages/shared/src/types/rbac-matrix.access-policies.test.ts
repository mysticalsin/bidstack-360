import { describe, expect, it } from 'vitest';

import { PERMISSION_KEYS } from './permissions.js';
import { RBAC_MATRIX } from './rbac-matrix.js';

const KEYS = ['access-policies:read', 'access-policies:write', 'access-policies:approve'] as const;

describe('access policy grants in the spec matrix', () => {
  it('declares read, write and approve keys', () => {
    for (const key of KEYS) expect(PERMISSION_KEYS).toContain(key);
  });

  it('only Admin may draft or approve an access policy', () => {
    // WHY: a published policy narrows what every role can reach. Drafting and
    // approving are tenant administration, never a sales or read-only grant.
    for (const key of ['access-policies:write', 'access-policies:approve'] as const) {
      const holders = Object.entries(RBAC_MATRIX)
        .filter(([, perms]) => perms.includes(key))
        .map(([role]) => role);
      expect(holders, key).toEqual(['Admin']);
    }
  });

  it('a read-only role can see policies but cannot change them', () => {
    expect(RBAC_MATRIX['Read-Only']).toContain('access-policies:read');
    expect(RBAC_MATRIX['Read-Only']).not.toContain('access-policies:write');
    expect(RBAC_MATRIX['Sales Manager']).not.toContain('access-policies:approve');
  });
});
