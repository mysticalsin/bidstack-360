import type { OppDrillFilter } from '@/components/drill/filterOpps';

/**
 * Bids behind each Performance chart.
 *
 * Revenue draws won actuals and the open forecast. A lost bid is in neither.
 * Win rate is the share of closed bids, so an open bid is not in that rate.
 * Top-account bars are won plus open. Lost value is left off those bars.
 */
export function performanceBreakdown(view: string): OppDrillFilter {
  if (view === 'winrate') return { book: 'closed' };
  if (view === 'accounts') return { book: 'accounts' };
  return { book: 'forecast' };
}
