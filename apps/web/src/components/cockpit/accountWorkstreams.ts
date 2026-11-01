/**
 * Account overview lanes. A lost pursuit must not become the account status,
 * and a missing buying role stays an empty slot. Renewal and expansion are
 * separate only when the stage says so — a title is not a workstream.
 */

import { compareMicros, microsSharePercent } from '@/components/dashboard/unspecified-currency';
import { unitsToMicros } from '@bidstack/shared';

export const BUYING_ROLES = ['buyer', 'champion', 'influencer', 'user', 'blocker'] as const;
export type BuyingRole = (typeof BUYING_ROLES)[number];

export type LiveWorkstream = 'pursuit' | 'delivery' | 'renewal' | 'expansion';
export type WorkstreamLane = LiveWorkstream | 'outcome';

export interface WorkDeal {
  id: string;
  name: string;
  stage: string | null;
  stageName?: string | null;
  isWon?: boolean;
  isLost?: boolean;
  value: number;
  /** Integer micros. The bar length uses this when every lane has it. */
  valueMicros?: string;
  owner: string | null;
}

/** Lane total. A micros string wins; otherwise the unit number is converted. */
export function laneRecordedMicros(deals: readonly WorkDeal[]): bigint {
  return deals.reduce((sum, deal) => {
    if (deal.valueMicros && /^\d+$/.test(deal.valueMicros)) return sum + BigInt(deal.valueMicros);
    return sum + (unitsToMicros(deal.value) ?? 0n);
  }, 0n);
}

export interface BuyingRolePerson {
  id: string;
  name: string;
  roleInDecision: string | null;
}

export function classifyWorkstream(deal: WorkDeal): WorkstreamLane {
  if (deal.isWon || deal.isLost) return 'outcome';
  const stage = `${deal.stage ?? ''} ${deal.stageName ?? ''}`.toLowerCase();
  if (/\bclosed[_\s-]?won\b|\bclosed[_\s-]?lost\b|\bwon\b|\blost\b/.test(stage)) return 'outcome';
  if (stage.includes('renew')) return 'renewal';
  if (stage.includes('expan') || stage.includes('upsell')) return 'expansion';
  if (stage.includes('customer') || stage.includes('deliver')) return 'delivery';
  return 'pursuit';
}

/**
 * Bar lengths as a share of the largest lane. Integer micros win when every
 * occupied lane has them, so two amounts that collapse as JS numbers still
 * draw different bars. A zero lane is 0.
 */
export function workstreamBarValues(
  rows: ReadonlyArray<{ value: number; valueMicros: string | null }>,
): number[] {
  const useMicros =
    rows.some((row) => row.valueMicros != null && row.valueMicros !== '0') &&
    rows.every((row) => row.valueMicros != null || row.value === 0);
  if (useMicros) {
    const max = rows.reduce((best, row) => {
      const micros = row.valueMicros ?? '0';
      return compareMicros(micros, best) > 0 ? micros : best;
    }, '0');
    return rows.map((row) => microsSharePercent(row.valueMicros ?? '0', max));
  }
  const maxUnits = rows.reduce((best, row) => Math.max(best, row.value), 0);
  if (maxUnits <= 0) return rows.map(() => 0);
  return rows.map((row) => (row.value <= 0 ? 0 : (row.value / maxUnits) * 100));
}

export function groupWorkstreams(deals: readonly WorkDeal[]): Record<WorkstreamLane, WorkDeal[]> {
  const grouped: Record<WorkstreamLane, WorkDeal[]> = {
    pursuit: [],
    delivery: [],
    renewal: [],
    expansion: [],
    outcome: [],
  };
  for (const deal of deals) grouped[classifyWorkstream(deal)].push(deal);
  return grouped;
}

export function buyingRoleSlots(
  people: readonly BuyingRolePerson[],
): Array<{ role: BuyingRole; people: BuyingRolePerson[] }> {
  return BUYING_ROLES.map((role) => ({
    role,
    people: people.filter((person) => person.roleInDecision === role),
  }));
}

/** Linked people with no accepted decision role. A title does not place them. */
export function peopleWithoutDecisionRole(people: readonly BuyingRolePerson[]): BuyingRolePerson[] {
  const placed = new Set(
    buyingRoleSlots(people).flatMap((slot) => slot.people.map((person) => person.id)),
  );
  return people.filter((person) => !placed.has(person.id));
}
