import { describe, expect, it } from 'vitest';

import {
  influenceProxyScore,
  riskLoadProgress,
  sourceReceiptTotal,
} from './CommandCenter';

describe('command center counts', () => {
  it('counts a stored logo once and does not add a receipt that is not there', () => {
    // Why: the tile showed 2 while the sentence said 1 attribution receipt.
    expect(sourceReceiptTotal(1, true)).toBe(2);
    expect(sourceReceiptTotal(1, false)).toBe(1);
    expect(sourceReceiptTotal(0, false)).toBe(0);
  });

  it('scores an empty buying group as 0', () => {
    // Why: the floor of 1 made "no people recorded" read as 1/5 influence.
    expect(influenceProxyScore([])).toBe(0);
    expect(influenceProxyScore([{ influence: null }])).toBe(0);
    expect(influenceProxyScore([{ influence: 4 }, { influence: 4 }])).toBe(4);
  });

  it('draws no risk load when nothing is open', () => {
    // Why: the bar used to fill to 100% when the count was 0 open.
    expect(riskLoadProgress(0, 0)).toBe(0);
    expect(riskLoadProgress(2, 1)).toBe(40);
  });
});
