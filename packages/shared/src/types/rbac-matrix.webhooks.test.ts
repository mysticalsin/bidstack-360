import { describe, expect, it } from 'vitest';

import { PERMISSION_KEYS } from './permissions.js';
import { RBAC_MATRIX } from './rbac-matrix.js';

describe('webhook replay grant in the spec matrix', () => {
  it('only Admin may replay a stored webhook message', () => {
    // WHY: replay re-sends a stored CRM payload to an external endpoint, so it
    // is a separate authority from reading or editing subscriptions.
    expect(PERMISSION_KEYS).toContain('webhooks:replay');
    const holders = Object.entries(RBAC_MATRIX)
      .filter(([, perms]) => perms.includes('webhooks:replay'))
      .map(([role]) => role);
    expect(holders).toEqual(['Admin']);
  });

  it('a role that can read webhooks cannot replay them by default', () => {
    expect(RBAC_MATRIX['Read-Only']).toContain('webhooks:read');
    expect(RBAC_MATRIX['Read-Only']).not.toContain('webhooks:replay');
    expect(RBAC_MATRIX['Sales Manager']).not.toContain('webhooks:replay');
  });
});
