import { describe, expect, it } from 'vitest';

import { isPermissionKey, PERMISSION_KEYS } from './permissions.js';
import { MATRIX_RESOURCES, RBAC_MATRIX, SYSTEM_ROLE_NAMES } from './rbac-matrix.js';

// External CRMs and Dust push activity through POST /api/v1/ingest/activities
// with an API key. The key needs its own exact scope so a general
// activities:write key (or a human role) does not silently become a bulk
// import channel.
describe('ingest:write permission', () => {
  it('is a declared permission key', () => {
    expect(PERMISSION_KEYS).toContain('ingest:write');
    expect(isPermissionKey('ingest:write')).toBe(true);
  });

  it('appears in the matrix display resources', () => {
    expect(MATRIX_RESOURCES).toContain('ingest');
  });

  it('is granted to Admin only among system roles', () => {
    for (const role of SYSTEM_ROLE_NAMES) {
      const has = RBAC_MATRIX[role].includes('ingest:write');
      expect({ role, has }).toEqual({ role, has: role === 'Admin' });
    }
  });
});
