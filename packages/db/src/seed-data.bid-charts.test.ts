import { describe, expect, it } from 'vitest';

import { BID_CRITERIA, WinLossReasonCode } from '@bidstack/shared';

import {
  demoActivities,
  demoBidScore,
  demoWinLoss,
  fixtureClosedDeals,
} from './seed-data.bid-charts.js';
import { fixtureOpps } from './seed-data.js';

const EM_DASH = '\u2014';

describe('bid chart demo fixtures', () => {
  it('display names carry no em dash', () => {
    for (const o of [...fixtureOpps, ...fixtureClosedDeals]) expect(o.name).not.toContain(EM_DASH);
  });

  it('every closed deal has one win/loss record with a known reason and a positive cycle', () => {
    const codes = new Set(fixtureClosedDeals.map((d) => d.code));
    expect(new Set(demoWinLoss.map((r) => r.code))).toEqual(codes);
    for (const r of demoWinLoss) {
      expect(WinLossReasonCode.options).toContain(r.reason);
      expect(r.cycleDays).toBeGreaterThan(0);
      const deal = fixtureClosedDeals.find((d) => d.code === r.code)!;
      expect(r.outcome).toBe(deal.stage === 'closed_won' ? 'won' : 'lost');
    }
  });

  it('the demo bid score rates only registry criteria on the 0 to 5 scale', () => {
    const ids = new Set(BID_CRITERIA.map((c) => c.id));
    for (const [id, rating] of Object.entries(demoBidScore.criteria)) {
      expect(ids.has(id)).toBe(true);
      expect(rating).toBeGreaterThanOrEqual(0);
      expect(rating).toBeLessThanOrEqual(5);
    }
    expect(fixtureOpps.some((o) => o.code === demoBidScore.oppCode)).toBe(true);
  });

  it('demo activities have stable ids, link to seeded bids and spread across the working day', () => {
    const codes = new Set([...fixtureOpps, ...fixtureClosedDeals].map((o) => o.code));
    expect(new Set(demoActivities.map((a) => a.id)).size).toBe(demoActivities.length);
    for (const a of demoActivities) expect(codes.has(a.oppCode)).toBe(true);
    expect(new Set(demoActivities.map((a) => a.hour)).size).toBeGreaterThan(6);
  });
});
