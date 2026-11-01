import { describe, expect, it } from 'vitest';

import {
  complianceShare,
  influenceProxyScore,
  openRiskFigures,
  readinessDetailFallback,
  riskLoadProgress,
  riskPenaltyFromRegister,
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

  it('does not call unseen open risks none recorded', () => {
    // WHY: a page of closed rows used to read as no open risks while more were open.
    const risk = {
      id: 'r1',
      title: 'Plant',
      severity: 'low' as const,
      status: 'mitigated' as const,
      owner: null,
      mitigation: null,
      dueDate: null,
    };
    expect(openRiskFigures({ risks: [], openRiskCount: 3, risksCapped: true })).toMatchObject({
      noneRecorded: false,
      openCount: 3,
      unseenOpen: true,
    });
    expect(openRiskFigures({ risks: [risk], openRiskCount: 0, risksCapped: true }).unseenOpen).toBe(
      false,
    );
  });

  it('does not treat the six visible checks as the account compliance rate', () => {
    // WHY: the card keeps six rows, open ones first. Six blocked cards and
    // forty compliant checks used to read as 0% compliant.
    const blocked = Array.from({ length: 6 }, () => ({ status: 'blocked' as const }));
    expect(
      complianceShare({ compliance: blocked, compliantCount: 40, complianceTotal: 46 }),
    ).toBeCloseTo((40 / 46) * 100);
    expect(complianceShare({ compliance: [], compliantCount: 0, complianceTotal: 0 })).toBe(0);
  });

  it('counts every open critical risk, not only the six on the card', () => {
    // WHY: one low card used to hide ten open critical risks in the readiness penalty.
    const low = {
      id: 'r1',
      title: 'Plant',
      severity: 'low' as const,
      status: 'open' as const,
      owner: null,
      mitigation: null,
      dueDate: null,
    };
    expect(
      riskPenaltyFromRegister({
        risks: [low],
        openRiskSeverity: { critical: 10, high: 0, medium: 0, low: 1 },
      }),
    ).toBe(10 * 14 + 1);
    expect(riskPenaltyFromRegister({ risks: [low] })).toBe(1);
  });

  it('names the opportunity page when register counts skip older deals', () => {
    // WHY: checks on deals past the latest 100 are not in the readiness mix.
    expect(readinessDetailFallback(true)).toBe(
      'weighted mix of checks on the latest 100 opportunities, not the whole account',
    );
    expect(readinessDetailFallback(false)).toBe(
      'weighted mix of recorded signals on this account, not a measured score',
    );
  });

  it('draws no risk load when nothing is open', () => {
    // Why: the bar used to fill to 100% when the count was 0 open.
    expect(riskLoadProgress(0, 0)).toBe(0);
    expect(riskLoadProgress(2, 1)).toBe(40);
  });
});
