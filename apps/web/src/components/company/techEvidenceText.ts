import { OPEN_TECH_LANE_LABELS, type TechnicalStackCoverage } from '@bidstack/shared';

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatCheckedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DATE.format(d);
}

/** Lane names grouped by outcome, for the coverage line. */
export function coverageParts(coverage: TechnicalStackCoverage): {
  found: string;
  nothing: string;
  notChecked: string;
  failed: string;
} {
  const label = (lane: TechnicalStackCoverage['lanes'][number]) => OPEN_TECH_LANE_LABELS[lane.lane];
  const pick = (status: string) =>
    coverage.lanes
      .filter((l) => l.status === status)
      .map(label)
      .join(', ');
  return {
    found: coverage.lanes
      .filter((l) => l.status === 'found')
      .map((l) => `${label(l)} ${l.count}`)
      .join(', '),
    nothing: pick('empty'),
    notChecked: pick('skipped'),
    failed: pick('failed'),
  };
}
