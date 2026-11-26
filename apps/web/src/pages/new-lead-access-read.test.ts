import { describe, expect, it } from 'vitest';

import { newLeadAccessPhase } from './new-lead-access-read';

const grant = {
  isAdmin: false,
  permissions: ['leads:write'],
};

describe('newLeadAccessPhase', () => {
  it('lets an error win over a stale grant', () => {
    // WHY: a refetch failure must not keep the create form, including when
    // isError has not flipped yet.
    expect(newLeadAccessPhase({ data: grant, isError: true, status: 'error' })).toBe('failed');
    expect(newLeadAccessPhase({ data: grant, isError: false, status: 'error' })).toBe('failed');
  });

  it('treats undefined data as unread', () => {
    // WHY: a pause has no payload. That is not a denied writer and not a failed load.
    expect(newLeadAccessPhase({ data: undefined, isError: false, status: 'pending' })).toBe('unread');
    expect(newLeadAccessPhase({ data: undefined, isError: false, status: 'idle' })).toBe('unread');
  });

  it('treats a settled payload as ready, including null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is no grant.
    expect(newLeadAccessPhase({ data: null, isError: false, status: 'success' })).toBe('ready');
    expect(newLeadAccessPhase({ data: grant, isError: false, status: 'success' })).toBe('ready');
  });
});
