import { describe, expect, it } from 'vitest';

import { proposalListStamp } from './proposal-list-stamp.js';

describe('proposalListStamp', () => {
  it('moves only updatedAt, so a section write does not rename the bid or change its stage', () => {
    // WHY: the desk orders by the proposal row. A section save and an AI
    // draft write the section table. The parent stamp has to be a time,
    // not a new name or a new stage, or the open bid would change under
    // the reader.
    const now = new Date('2026-11-25T18:04:00.000Z');
    expect(proposalListStamp(now)).toEqual({ updatedAt: now });
  });
});
