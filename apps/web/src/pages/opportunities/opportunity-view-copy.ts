// Copy for the opportunities list when a due, stage, or search filter is on.
// A filtered miss is not an empty book. The demo bids are dated mid-2026, and
// "Due ≤ 7d" is a forward window, so that chip can match nothing while the
// book is still full of overdue bids.

export type DueQuickFilter = 'within7' | 'overdue' | null;

export interface OpportunityView {
  search: string | undefined;
  stageFilter: string | null;
  stageLabel: string;
  dueFilter: DueQuickFilter;
  count: number;
}

export interface CopyLine {
  key: string;
  fallback: string;
  vars?: Record<string, string | number>;
}

export interface FilteredEmpty {
  kind: 'filtered';
  title: CopyLine;
  message: CopyLine;
  clear: 'filter' | 'filters';
}

export type OpportunityEmpty = { kind: 'book' } | FilteredEmpty;

function activeFilterCount(view: OpportunityView): number {
  return [Boolean(view.search), Boolean(view.stageFilter), Boolean(view.dueFilter)].filter(Boolean)
    .length;
}

/** Empty-state copy. `book` is the first-run pitch; anything else is a filter miss. */
export function opportunityEmpty(view: OpportunityView): OpportunityEmpty {
  const active = activeFilterCount(view);
  if (active === 0) return { kind: 'book' };
  if (active > 1) {
    return {
      kind: 'filtered',
      title: {
        key: 'opportunities.empty.viewTitle',
        fallback: 'No opportunities match this view',
      },
      message: {
        key: 'opportunities.empty.viewMessage',
        fallback: 'Clear the filters to see the rest of the book.',
      },
      clear: 'filters',
    };
  }
  if (view.dueFilter === 'within7') {
    return {
      kind: 'filtered',
      title: {
        key: 'opportunities.empty.dueWithin7Title',
        fallback: 'Nothing due in the next 7 days',
      },
      message: {
        key: 'opportunities.empty.dueWithin7Message',
        fallback: 'The rest of the book is still here. Clear the filter to see it.',
      },
      clear: 'filter',
    };
  }
  if (view.dueFilter === 'overdue') {
    return {
      kind: 'filtered',
      title: { key: 'opportunities.empty.overdueTitle', fallback: 'No overdue bids' },
      message: {
        key: 'opportunities.empty.overdueMessage',
        fallback:
          'Nothing in this list is past its due date. Clear the filter to see the rest of the book.',
      },
      clear: 'filter',
    };
  }
  if (view.stageFilter) {
    return {
      kind: 'filtered',
      title: {
        key: 'opportunities.empty.stageTitle',
        fallback: 'No opportunities in this stage',
      },
      message: {
        key: 'opportunities.empty.stageMessage',
        fallback: 'Clear the filter to see the rest of the book.',
      },
      clear: 'filter',
    };
  }
  return {
    kind: 'filtered',
    title: {
      key: 'opportunities.empty.searchTitle',
      fallback: 'No opportunities match your search',
    },
    message: {
      key: 'opportunities.empty.searchMessage',
      fallback: 'Nothing matched "{{search}}".',
      vars: { search: view.search ?? '' },
    },
    clear: 'filter',
  };
}

export interface OpportunitySubtitle {
  /** `inflight` is the unfiltered sentence. `stage` keeps the existing stage line. */
  kind: 'search' | 'inflight' | 'stage' | 'due' | 'due-and-stage';
  /** Words after the count, for due lines. */
  phrase?: CopyLine;
  clear: 'filter' | 'filters' | null;
}

function duePhrase(view: OpportunityView): CopyLine {
  const one = view.count === 1;
  if (view.dueFilter === 'overdue') {
    return one
      ? { key: 'oppToolbar.bidOverdue', fallback: 'overdue bid' }
      : { key: 'oppToolbar.bidsOverdue', fallback: 'overdue bids' };
  }
  return one
    ? { key: 'oppToolbar.bidDueWithin7', fallback: 'bid due within 7 days' }
    : { key: 'oppToolbar.bidsDueWithin7', fallback: 'bids due within 7 days' };
}

/** Subtitle under the page title. A due filter is not "bids in flight". */
export function opportunitySubtitle(view: OpportunityView): OpportunitySubtitle {
  if (view.search) return { kind: 'search', clear: null };
  if (view.dueFilter && view.stageFilter) {
    return {
      kind: 'due-and-stage',
      phrase: {
        key: 'oppToolbar.dueStageOpportunities',
        fallback: '{{due}} {{stage}} opportunities',
        vars: {
          due: view.dueFilter === 'overdue' ? 'overdue' : 'due within 7 days',
          stage: view.stageLabel.toLowerCase(),
        },
      },
      clear: 'filters',
    };
  }
  if (view.dueFilter) return { kind: 'due', phrase: duePhrase(view), clear: 'filter' };
  if (view.stageFilter) return { kind: 'stage', clear: 'filter' };
  return { kind: 'inflight', clear: null };
}
