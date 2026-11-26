import { describe, expect, it } from 'vitest';

import { intakeAccessPhase } from './intake-access-read';

const grant = {
  isAdmin: false,
  permissions: ['msa:write'],
};

describe('intakeAccessPhase', () => {
  it('lets an error win over a stale grant', () => {
    // WHY: a refetch failure must not keep the drop target, including when
    // isError has not flipped yet.
    expect(intakeAccessPhase({ data: grant, isError: true, status: 'error' })).toBe('failed');
    expect(intakeAccessPhase({ data: grant, isError: false, status: 'error' })).toBe('failed');
  });

  it('treats undefined data as unread', () => {
    // WHY: a pause has no payload. That is not a denied uploader and not a failed load.
    expect(intakeAccessPhase({ data: undefined, isError: false, status: 'pending' })).toBe('unread');
    expect(intakeAccessPhase({ data: undefined, isError: false, status: 'idle' })).toBe('unread');
  });

  it('treats a settled payload as ready, including null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is no grant.
    expect(intakeAccessPhase({ data: null, isError: false, status: 'success' })).toBe('ready');
    expect(intakeAccessPhase({ data: grant, isError: false, status: 'success' })).toBe('ready');
  });
});
