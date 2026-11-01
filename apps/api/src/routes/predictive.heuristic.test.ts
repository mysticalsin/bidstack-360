import { describe, expect, it } from 'vitest';

import { heuristicScoreDraft } from './predictive.js';

describe('heuristicScoreDraft', () => {
  it('does not invent a win, churn, or lead score when no model is trained', () => {
    // WHY: the route used to persist 7200 confidence from a stage table,
    // a churn score with a fake 12-day gap, and a lead score with industry
    // fit 0.8. Those numbers were not measured, so nothing is written.
    expect(heuristicScoreDraft()).toBeNull();
  });
});