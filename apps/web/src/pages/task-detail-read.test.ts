import { describe, expect, it } from 'vitest';

import { taskDetailPhase } from './task-detail-read';

const task = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Northwind printer follow-up',
  items: [] as unknown[],
};

describe('taskDetailPhase', () => {
  it('lets an error win over a stale task', () => {
    // WHY: a refetch failure must not keep the task that was already on screen,
    // including when isError has not flipped yet.
    expect(taskDetailPhase({ data: { items: [task], nextCursor: null }, isError: true, status: 'error' })).toBe(
      'failed',
    );
    expect(taskDetailPhase({ data: { items: [task], nextCursor: null }, isError: false, status: 'error' })).toBe(
      'failed',
    );
  });

  it('treats undefined data as unread', () => {
    // WHY: a pause has no payload. That is not a deleted task and not a failed load.
    expect(taskDetailPhase({ data: undefined, isError: false, status: 'pending' })).toBe('unread');
    expect(taskDetailPhase({ data: undefined, isError: false, status: 'idle' })).toBe('unread');
  });

  it('treats a settled payload as ready, including null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is a missing task.
    expect(taskDetailPhase({ data: null, isError: false, status: 'success' })).toBe('ready');
    expect(taskDetailPhase({ data: { items: [], nextCursor: null }, isError: false, status: 'success' })).toBe(
      'ready',
    );
  });
});
