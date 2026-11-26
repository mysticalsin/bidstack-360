import { describe, expect, it } from 'vitest';

import { emailThreadPhase } from './email-thread-read';

const thread = { threadId: 't-northwind-printer', subject: 'Northwind printer quote', messages: [] };

describe('emailThreadPhase', () => {
  it('lets an error win over a stale thread', () => {
    // WHY: a refetch failure must not keep the message that was already on screen,
    // including when isError has not flipped yet.
    expect(emailThreadPhase({ data: thread, isError: true, status: 'error' })).toBe('failed');
    expect(emailThreadPhase({ data: thread, isError: false, status: 'error' })).toBe('failed');
  });

  it('treats undefined data as unread', () => {
    // WHY: a pause has no payload. That is not a failed load and not an empty thread.
    expect(emailThreadPhase({ data: undefined, isError: false, status: 'pending' })).toBe('unread');
    expect(emailThreadPhase({ data: undefined, isError: false, status: 'idle' })).toBe('unread');
  });

  it('treats a settled payload as ready, including null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is an empty thread.
    expect(emailThreadPhase({ data: null, isError: false, status: 'success' })).toBe('ready');
    expect(
      emailThreadPhase({
        data: { threadId: 't-northwind-printer', subject: '', messages: [] },
        isError: false,
        status: 'success',
      }),
    ).toBe('ready');
  });
});
