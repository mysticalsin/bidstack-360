import { describe, expect, it } from 'vitest';

import { taskRecordPhase } from './task-record-read';

describe('taskRecordPhase', () => {
  it('does not treat a paused read with no list as a deleted follow-up', () => {
    // A pause reports isLoading false. That is not a settled miss.
    expect(
      taskRecordPhase({
        hasTask: false,
        hasPayload: false,
        isLoading: false,
        isPending: true,
        isError: false,
        status: 'pending',
        fetchStatus: 'paused',
      }),
    ).toBe('unread');
  });

  it('does not treat an in-flight read as a deleted follow-up', () => {
    expect(
      taskRecordPhase({
        hasTask: false,
        hasPayload: false,
        isLoading: true,
        isPending: true,
        isError: false,
        status: 'pending',
        fetchStatus: 'fetching',
      }),
    ).toBe('unread');
  });

  it('keeps a failed read as a failure', () => {
    expect(
      taskRecordPhase({
        hasTask: false,
        hasPayload: false,
        isLoading: false,
        isPending: false,
        isError: true,
        status: 'error',
        fetchStatus: 'idle',
      }),
    ).toBe('failed');
  });

  it('keeps a settled list that does not hold the id as missing', () => {
    // Zero rows is honest only after the list arrived.
    expect(
      taskRecordPhase({
        hasTask: false,
        hasPayload: true,
        isLoading: false,
        isPending: false,
        isError: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    ).toBe('missing');
  });

  it('keeps a follow-up that arrived', () => {
    expect(
      taskRecordPhase({
        hasTask: true,
        hasPayload: true,
        isLoading: false,
        isPending: false,
        isError: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    ).toBe('ready');
  });
});
