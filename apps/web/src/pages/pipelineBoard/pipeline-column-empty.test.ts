import { describe, expect, it } from 'vitest';

import { pipelineColumnEmptyCopy } from './pipeline-column-empty';

describe('pipelineColumnEmptyCopy', () => {
  it('says a finished page has no bids, and only offers a drop to someone who can move one', () => {
    // WHY: demo Lead is an empty first column and the loaded page is the book.
    // The column used to say only "Drop here", so a viewer was told to do a
    // move the board withholds, and a writer never heard that the stage was empty.
    expect(pipelineColumnEmptyCopy({ canWrite: true, pageContinues: false })).toEqual({
      state: 'No bids',
      action: 'Drop one here',
    });
    expect(pipelineColumnEmptyCopy({ canWrite: false, pageContinues: false })).toEqual({
      state: 'No bids',
      action: null,
    });
  });

  it('does not call a continued page an empty stage', () => {
    // WHY: the board stops at 50 cards. An empty column on that page is not
    // proof the stage has no bids. "No bids" would contradict the column count.
    expect(pipelineColumnEmptyCopy({ canWrite: true, pageContinues: true })).toEqual({
      state: 'None in the latest bids',
      action: 'Drop one here',
    });
    expect(pipelineColumnEmptyCopy({ canWrite: false, pageContinues: true }).action).toBeNull();
    expect(pipelineColumnEmptyCopy({ canWrite: false, pageContinues: true }).state).toBe(
      'None in the latest bids',
    );
  });
});
