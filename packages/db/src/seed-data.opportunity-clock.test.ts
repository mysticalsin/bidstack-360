import { describe, expect, it } from 'vitest';

import { FIXTURE_OPEN_DUE_DATES } from '@bidstack/shared';
import { OpportunityStage } from '../generated/client/index.js';

import { fixtureOpps } from './seed-data.js';

describe('open fixture due dates and the demo clock', () => {
  it('lists the same open due dates the read-time clock slides', () => {
    // WHY: the clock table is a copy of the seed. If a new open fixture date
    // lands only in one of them, a restored snapshot ages out of the window.
    const open = Object.fromEntries(
      fixtureOpps
        .filter((o) => o.stage !== OpportunityStage.closed_won && o.stage !== OpportunityStage.closed_lost)
        .map((o) => [o.code, o.dueDate]),
    );
    expect(open).toEqual(FIXTURE_OPEN_DUE_DATES);
  });
});
