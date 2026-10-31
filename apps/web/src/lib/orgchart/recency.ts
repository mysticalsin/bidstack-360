// Meeting recency for the chart: green "Met recently" within 30 days, amber
// within 90, grey when longer ago, nothing when never met.
const DAY = 86_400_000;

export type Recency = 'recent' | 'warm' | 'stale' | 'never';

export function recencyOf(lastMetAt: string | null | undefined, now: number): Recency {
  if (!lastMetAt || !now) return 'never';
  const t = Date.parse(lastMetAt);
  if (Number.isNaN(t)) return 'never';
  const days = Math.max(0, Math.floor((now - t) / DAY));
  if (days <= 30) return 'recent';
  if (days <= 90) return 'warm';
  return 'stale';
}

/** Short badge label shown on the node (null: no badge). */
export function recencyBadge(lastMetAt: string | null | undefined, now: number): string | null {
  const r = recencyOf(lastMetAt, now);
  if (r === 'recent') return 'Met recently';
  if (r === 'warm') {
    const weeks = Math.max(5, Math.round((now - Date.parse(lastMetAt!)) / (7 * DAY)));
    return `Met ${weeks} wk ago`;
  }
  return null;
}

export const fmtMetDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Tooltip text: the last meeting date, or that nobody has met them. */
export function recencyTitle(lastMetAt: string | null | undefined): string {
  return lastMetAt ? `Last met ${fmtMetDate(lastMetAt)}` : 'Not met yet';
}
