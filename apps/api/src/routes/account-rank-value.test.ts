import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { rankByAccount, rankValueUnits } from './account-rank-value.js';

// The demo book is fixtureOpps plus the historical closed deals. A lost bid
// is not pipeline and it is not revenue. Summing every opportunity made
// CI Financial 6.23m (the open 1.24m plus won history plus the lost Managed
// SOC and the lost retirement) and put NOS, whose only bid is lost, above
// MAPFRE, Mantu, Aritzia, and Logistec.

const demoBook = [
  { customer: 'CI Financial', stage: 's3_technical_iteration', value: 1_240_000 },
  { customer: 'Logistec Corporation', stage: 's1_ongoing', value: 320_000 },
  { customer: 'Rush University System for Health', stage: 's4_negotiation', value: 4_800_000 },
  { customer: 'MAPFRE', stage: 's1_ongoing', value: 680_000 },
  { customer: 'MAHLE', stage: 's2_sent', value: 2_150_000 },
  { customer: 'Aritzia', stage: 'closed_won', value: 410_000 },
  { customer: 'NOS', stage: 'closed_lost', value: 1_900_000 },
  { customer: 'DNB Bank', stage: 's1_ongoing', value: 2_700_000 },
  { customer: 'CI Financial', stage: 'closed_won', value: 880_000 },
  { customer: 'CI Financial', stage: 'closed_won', value: 540_000 },
  { customer: 'CI Financial', stage: 'closed_lost', value: 1_200_000 },
  { customer: 'CI Financial', stage: 'closed_won', value: 720_000 },
  { customer: 'CI Financial', stage: 'closed_won', value: 1_350_000 },
  { customer: 'CI Financial', stage: 'closed_lost', value: 300_000 },
  { customer: 'Rush University System for Health', stage: 'closed_won', value: 2_100_000 },
  { customer: 'Rush University System for Health', stage: 'closed_won', value: 1_450_000 },
  { customer: 'Mantu', stage: 'closed_won', value: 410_000 },
  { customer: 'Mantu', stage: 'closed_lost', value: 260_000 },
];

function valueOf(customer: string): number {
  return rankByAccount(demoBook).find((row) => row.customer === customer)?.totalValue ?? -1;
}

describe('account ranking value', () => {
  it('keeps lost demo bids out of the rank total', () => {
    // WHY: Strategic Accounts and Account Ranking both show this total as the
    // account's value. OP-H03 (1.2m) and OP-H06 (300k) are lost, so CI is
    // 4.73m of open pipeline plus won revenue, not 6.23m. OP-2047 is NOS's
    // only bid and it is lost, so NOS is not a 1.9m account. OP-H10 is lost,
    // so Mantu stays at the won 410k. A won bid still counts.
    expect(valueOf('CI Financial')).toBe(4_730_000);
    expect(valueOf('CI Financial')).not.toBe(6_230_000);
    expect(valueOf('NOS')).toBe(0);
    expect(valueOf('Mantu')).toBe(410_000);
    expect(valueOf('Aritzia')).toBe(410_000);
    expect(valueOf('Rush University System for Health')).toBe(8_350_000);

    const positive = rankByAccount(demoBook)
      .filter((row) => row.totalValue > 0)
      .map((row) => row.customer);
    expect(positive.slice(0, 5)).toEqual([
      'Rush University System for Health',
      'CI Financial',
      'DNB Bank',
      'MAHLE',
      'MAPFRE',
    ]);
    expect(positive).not.toContain('NOS');
    expect(positive.indexOf('MAPFRE')).toBeLessThan(positive.indexOf('Logistec Corporation'));
  });

  it('subtracts lost micros before the total becomes a unit amount', () => {
    // WHY: the curated and key-account reads sum micros in Postgres. CI's
    // 6.23m micros minus the 1.5m lost micros is 4.73m. A book that is only
    // lost is zero, not a negative.
    expect(rankValueUnits(6_230_000_000_000n, 1_500_000_000_000n)).toBe(4_730_000);
    expect(rankValueUnits(1_900_000_000_000n, 1_900_000_000_000n)).toBe(0);
    expect(rankValueUnits(410_000_000_000n, 0n)).toBe(410_000);
  });

  it('uses that exclusion on the auto leaderboard and the shared account stats', () => {
    // WHY: the rank page reads /accounts/top. Curated and key accounts share
    // fetchAccountStats. The auto leaderboard has its own SUM. Either path
    // summing every value_micros puts the lost bids back into the number.
    const route = readFileSync(new URL('./accounts.ts', import.meta.url), 'utf8');
    const helpers = readFileSync(new URL('./accounts.helpers.ts', import.meta.url), 'utf8');
    expect(route).toContain('ACCOUNT_RANK_EXCLUDED_STAGE');
    expect(route).not.toContain('SUM(o.value_micros)');
    expect(helpers).toContain('rankValueUnits');
    expect(helpers).toContain('ACCOUNT_RANK_EXCLUDED_STAGE');
  });
});
