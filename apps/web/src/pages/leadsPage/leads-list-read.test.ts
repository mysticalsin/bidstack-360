import { describe, expect, it } from 'vitest';

import { leadsListFailedMessage, leadsListRead, leadsListUnreadMessage } from './leads-list-read';

// A missing payload is not an empty funnel and not a pipeline-ready count.
const NOT_A_SETTLED_ANSWER = /\b(0|zero|empty|none|ready)\b/i;

describe('leadsListRead', () => {
  it('does not treat a missing payload as pipeline-ready or empty', () => {
    // A paused read often arrives as an empty list. That is not a funnel
    // with no rows, and it is not zero qualified leads.
    expect(leadsListRead({ isPending: true, isError: false, items: [] })).toEqual({
      phase: 'unread',
    });
    expect(leadsListRead({ isPending: true, isError: false, items: null })).toEqual({
      phase: 'unread',
    });
    expect(leadsListUnreadMessage()).toBe('Checking leads. They have not arrived.');
    expect(leadsListUnreadMessage()).not.toMatch(NOT_A_SETTLED_ANSWER);
  });

  it('does not treat a failed read as pipeline-ready or empty', () => {
    expect(leadsListRead({ isPending: false, isError: true, items: null })).toEqual({
      phase: 'failed',
    });
    expect(leadsListFailedMessage()).toBe('Could not load leads. The leads have not arrived.');
    expect(leadsListFailedMessage()).not.toMatch(NOT_A_SETTLED_ANSWER);
  });

  it('keeps an arrived empty funnel empty', () => {
    // Zero is honest only after the payload landed and held no rows.
    expect(leadsListRead({ isPending: false, isError: false, items: [] })).toEqual({
      phase: 'empty',
      pipelineReady: 0,
    });
  });

  it('counts a qualified outreach lead only after the payload arrives', () => {
    expect(
      leadsListRead({
        isPending: false,
        isError: false,
        items: [{ status: 'qualified' }],
      }),
    ).toEqual({ phase: 'ready', pipelineReady: 1 });
  });

  it('does not call an arrived new lead pipeline-ready', () => {
    expect(
      leadsListRead({
        isPending: false,
        isError: false,
        items: [{ status: 'new' }],
      }),
    ).toEqual({ phase: 'ready', pipelineReady: 0 });
  });
});
