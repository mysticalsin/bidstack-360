import { describe, expect, it } from 'vitest';

import { opportunityEmpty, opportunitySubtitle, type OpportunityView } from './opportunity-view-copy';

// The demo bids are dated mid-2026. "Due ≤ 7d" only matches a forward window,
// so a later day returns no rows. That miss must not read as an empty book,
// and a row that is overdue must not be described as merely in flight.
function view(over: Partial<OpportunityView> = {}): OpportunityView {
  return {
    search: undefined,
    stageFilter: null,
    stageLabel: '',
    dueFilter: null,
    count: 0,
    ...over,
  };
}

describe('opportunity view copy', () => {
  it('keeps the first-run empty state only when no filter is on', () => {
    expect(opportunityEmpty(view()).kind).toBe('book');
    expect(opportunitySubtitle(view()).kind).toBe('inflight');
  });

  it('treats a 7-day miss as a filter, including a count of zero', () => {
    const empty = opportunityEmpty(view({ dueFilter: 'within7' }));
    expect(empty.kind).toBe('filtered');
    if (empty.kind !== 'filtered') return;
    expect(empty.title.fallback).toBe('Nothing due in the next 7 days');
    expect(empty.message.fallback).toContain('The rest of the book is still here');
    expect(empty.clear).toBe('filter');

    const subtitle = opportunitySubtitle(view({ dueFilter: 'within7', count: 0 }));
    expect(subtitle.kind).toBe('due');
    expect(subtitle.phrase?.fallback).toBe('bids due within 7 days');
  });

  it('names one overdue row as overdue, and many as overdue bids', () => {
    expect(opportunitySubtitle(view({ dueFilter: 'overdue', count: 1 })).phrase?.fallback).toBe(
      'overdue bid',
    );
    expect(opportunitySubtitle(view({ dueFilter: 'overdue', count: 6 })).phrase?.fallback).toBe(
      'overdue bids',
    );
  });

  it('uses the plural clear when a stage and a due filter are both on', () => {
    const empty = opportunityEmpty(
      view({ dueFilter: 'overdue', stageFilter: 's2_sent', stageLabel: 'S2 Sent' }),
    );
    expect(empty.kind).toBe('filtered');
    if (empty.kind !== 'filtered') return;
    expect(empty.title.fallback).toBe('No opportunities match this view');
    expect(empty.clear).toBe('filters');

    const subtitle = opportunitySubtitle(
      view({ dueFilter: 'within7', stageFilter: 's2_sent', stageLabel: 'S2 Sent', count: 0 }),
    );
    expect(subtitle.clear).toBe('filters');
    expect(subtitle.phrase?.vars).toMatchObject({
      due: 'due within 7 days',
      stage: 's2 sent',
    });
  });

  it('keeps a search miss and a stage miss off the first-run pitch', () => {
    const search = opportunityEmpty(view({ search: 'nomatch' }));
    expect(search.kind).toBe('filtered');
    if (search.kind === 'filtered') {
      expect(search.title.fallback).toBe('No opportunities match your search');
      expect(search.message.vars).toEqual({ search: 'nomatch' });
    }
    const stage = opportunityEmpty(view({ stageFilter: 's1_lead' }));
    expect(stage.kind).toBe('filtered');
    if (stage.kind === 'filtered') {
      expect(stage.title.fallback).toBe('No opportunities in this stage');
    }
  });
});
