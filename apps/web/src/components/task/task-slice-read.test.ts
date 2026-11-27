import { describe, expect, it } from 'vitest';

import { taskSliceRead, taskSliceReadMessage } from './task-slice-read';

const NOT_A_COUNT = /\b(0|zero|empty|none)\b/i;

describe('taskSliceRead', () => {
  it('does not treat a missing Recent payload as an empty book', () => {
    // A paused read often arrives as count 0. That is not a book with no rows.
    expect(
      taskSliceRead({ isPending: true, isError: false, count: 0 }),
    ).toEqual({ phase: 'unread' });
    expect(taskSliceReadMessage('recent', 'unread')).toBe('Checking recent follow-ups.');
    expect(taskSliceReadMessage('recent', 'unread')).not.toMatch(NOT_A_COUNT);
  });

  it('does not treat a failed Recent read as zero', () => {
    expect(
      taskSliceRead({ isPending: false, isError: true, count: 0 }),
    ).toEqual({ phase: 'failed' });
    expect(taskSliceReadMessage('recent', 'failed')).not.toMatch(NOT_A_COUNT);
  });

  it('keeps an arrived empty Recent book empty', () => {
    // Zero is honest only after the payload landed and held no rows.
    expect(
      taskSliceRead({ isPending: false, isError: false, count: 0 }),
    ).toEqual({ phase: 'empty' });
  });

  it('keeps an arrived Recent row', () => {
    expect(
      taskSliceRead({ isPending: false, isError: false, count: 1 }),
    ).toEqual({ phase: 'ready', count: 1 });
  });

  it('does not treat a missing list payload as empty', () => {
    expect(taskSliceRead({ isPending: true, isError: false, count: null })).toEqual({
      phase: 'unread',
    });
    expect(taskSliceReadMessage('list', 'failed')).not.toMatch(NOT_A_COUNT);
  });
});
