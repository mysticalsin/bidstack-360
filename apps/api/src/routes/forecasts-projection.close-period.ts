/**
 * Quarter a closed-won bid belongs in.
 *
 * The projection window is the current quarter plus the next two. A won bid
 * is an actual, so it follows closed_at. due_date is the date the rep hoped
 * to close, and demo seed sets that 45 days out on every bid, including ones
 * that are already won. The close trigger stamps closed_at at insert.
 */
import type { ProjectionWindow } from './forecasts-projection.helpers.js';

/** Period key for `closedAt`, or null when it falls outside the window. */
export function wonForecastPeriod(
  closedAt: Date | null,
  window: Pick<ProjectionWindow, 'periods' | 'curQuarterStart' | 'windowEndExclusive'>,
): string | null {
  if (!closedAt || Number.isNaN(closedAt.getTime())) return null;
  const day = Date.UTC(closedAt.getUTCFullYear(), closedAt.getUTCMonth(), closedAt.getUTCDate());
  if (day < window.curQuarterStart.getTime() || day >= window.windowEndExclusive.getTime()) return null;
  const key = `${closedAt.getUTCFullYear()}-Q${Math.floor(closedAt.getUTCMonth() / 3) + 1}`;
  return window.periods.includes(key) ? key : null;
}
