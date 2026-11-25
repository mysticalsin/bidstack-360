import { microsToUnits } from '@bidstack/shared';

/**
 * A lost bid is neither pipeline nor revenue. Strategic Accounts and Account
 * Ranking both show `totalValue` as the account's value, so a closed_lost
 * amount must not raise the rank or the figure next to it. Won revenue stays.
 */
export const ACCOUNT_RANK_EXCLUDED_STAGE = 'closed_lost' as const;

export interface RankDeal {
  customer: string;
  stage: string;
  value: number;
}

export interface RankedAccount {
  customer: string;
  totalValue: number;
}

export function accountRankValue(deals: ReadonlyArray<Pick<RankDeal, 'stage' | 'value'>>): number {
  return deals.reduce(
    (sum, deal) => (deal.stage === ACCOUNT_RANK_EXCLUDED_STAGE ? sum : sum + deal.value),
    0,
  );
}

export function rankByAccount(deals: ReadonlyArray<RankDeal>): RankedAccount[] {
  const totals = new Map<string, number>();
  for (const deal of deals) {
    const current = totals.get(deal.customer) ?? 0;
    totals.set(deal.customer, current + accountRankValue([deal]));
  }
  return [...totals.entries()]
    .map(([customer, totalValue]) => ({ customer, totalValue }))
    .sort((a, b) => b.totalValue - a.totalValue || a.customer.localeCompare(b.customer));
}

function asMicros(value: bigint | number | null | undefined): bigint {
  if (value == null) return 0n;
  return typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
}

/** Unit amount after lost micros are taken out of the Postgres sum. */
export function rankValueUnits(
  allMicros: bigint | number | null | undefined,
  lostMicros: bigint | number | null | undefined,
): number {
  const all = asMicros(allMicros);
  const lost = asMicros(lostMicros);
  const rankable = all > lost ? all - lost : 0n;
  return microsToUnits(rankable);
}
