import { describe, expect, it } from 'vitest';

import { dealTimelineEmptyKind } from './deal-timeline-empty';

describe('deal activity empty sentence', () => {
  it('names a seeded closed_won row as won when the activity list is empty', () => {
    // WHY: historical demo wins store stage closed_won and no timeline rows.
    // The activity tab has to say the deal is already won.
    expect(dealTimelineEmptyKind({ stage: 'closed_won', pipelineStage: null })).toBe('won');
  });

  it('names a pipeline lost stage as lost even when the stage label is not the enum', () => {
    // WHY: the wire stage is the pipeline name. isLost is what the deal page uses.
    expect(
      dealTimelineEmptyKind({
        stage: 'Lost',
        pipelineStage: { isWon: false, isLost: true },
      }),
    ).toBe('lost');
  });

  it('keeps an open bid on the open sentence', () => {
    // WHY: an open bid with no rows really has no activity yet.
    expect(
      dealTimelineEmptyKind({
        stage: 's4_negotiation',
        pipelineStage: { isWon: false, isLost: false },
      }),
    ).toBe('open');
  });

  it('treats a missing deal record as open', () => {
    // WHY: the activity list must not invent a close when the record did not load.
    expect(dealTimelineEmptyKind(null)).toBe('open');
    expect(dealTimelineEmptyKind(undefined)).toBe('open');
    expect(dealTimelineEmptyKind({})).toBe('open');
  });

  it('lets won win when both outcome flags are set', () => {
    // WHY: the deal page checks won first. The empty sentence uses that order.
    expect(
      dealTimelineEmptyKind({
        stage: 'closed_won',
        pipelineStage: { isWon: true, isLost: true },
      }),
    ).toBe('won');
  });

  it('names a pipeline won stage whose label is not closed_won', () => {
    expect(
      dealTimelineEmptyKind({
        stage: 'Closed Won',
        pipelineStage: { isWon: true, isLost: false },
      }),
    ).toBe('won');
  });
});
