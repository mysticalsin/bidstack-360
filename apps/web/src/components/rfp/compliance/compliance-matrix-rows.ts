// The matrix's row pipeline: filter → sort → page. Pure functions, no React —
// the whole matrix arrives in one response (the API takes 500 rows,
// bid-workspace.ts:141), so every view the URL describes is computed here.
//
// Kept out of the component for two reasons: the component is already carrying
// a table, a toolbar and a fact fan-out, and these rules (especially where
// "unknown" sorts) are exactly the kind of thing that should be pinned by a
// unit test rather than eyeballed in a screenshot.

import type { ComplianceRow } from '@/hooks/rfp/useRfpCompliance';
import type { SortDirection } from '@/lib/table/table-query';

export const ALL = 'all';

export interface ComplianceRowFilter {
  /** Tab segment: a ComplianceRow['status'] or 'all'. */
  status: string;
  /** Facet segment: a requirement type or 'all'. */
  section: string;
  /** Facet segment: 'yes' | 'no' | 'all'. */
  mandatory: string;
  /** Free-text over the requirement and the current answer. */
  q: string;
}

export function filterComplianceRows(
  rows: readonly ComplianceRow[],
  filter: ComplianceRowFilter,
): ComplianceRow[] {
  const needle = filter.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.status !== ALL && row.status !== filter.status) return false;
    if (filter.section !== ALL && (row.section ?? '') !== filter.section) return false;
    if (filter.mandatory !== ALL && row.mandatory !== (filter.mandatory === 'yes')) return false;
    if (needle) {
      const haystack = `${row.requirement} ${row.response ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

// Reading order for the status column, worst-known first. `pending` sits LAST
// on purpose: it is not a bad outcome, it is an absent one, and a matrix that
// sorts unknowns to the top reads as a wall of failures.
const STATUS_RANK: Record<ComplianceRow['status'], number> = {
  non_compliant: 0,
  partial: 1,
  compliant: 2,
  pending: 3,
};

export function sortComplianceRows(
  rows: readonly ComplianceRow[],
  sort: string,
  dir: SortDirection,
): ComplianceRow[] {
  if (!sort) return [...rows];
  const sign = dir === 'desc' ? -1 : 1;
  const sorted = [...rows];

  if (sort === 'confidence') {
    // Nulls last in BOTH directions. A row with no assessment has not scored
    // zero — flipping the sort must not parade "not assessed" as "worst".
    sorted.sort((a, b) => {
      if (a.aiConfidenceBps === null && b.aiConfidenceBps === null) return 0;
      if (a.aiConfidenceBps === null) return 1;
      if (b.aiConfidenceBps === null) return -1;
      return sign * (a.aiConfidenceBps - b.aiConfidenceBps);
    });
    return sorted;
  }

  if (sort === 'status') {
    sorted.sort((a, b) => sign * (STATUS_RANK[a.status] - STATUS_RANK[b.status]));
    return sorted;
  }

  sorted.sort((a, b) => sign * a.requirement.localeCompare(b.requirement));
  return sorted;
}

export function pageOfRows(
  rows: readonly ComplianceRow[],
  page: number,
  pageSize: number,
): ComplianceRow[] {
  const start = Math.max(0, (page - 1) * pageSize);
  return rows.slice(start, start + pageSize);
}

/** Facet options for `section`, derived from the data — there is no taxonomy table. */
export function sectionOptions(
  rows: readonly ComplianceRow[],
): { value: string; label: string }[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.section) seen.add(row.section);
  }
  return [...seen]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: humaniseSection(value) }));
}

/** `technical_capability` → `Technical capability`. Snake case is a wire format. */
export function humaniseSection(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** How many rows sit behind each tab/facet segment, for the toolbar counts. */
export function statusCounts(
  rows: readonly ComplianceRow[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}
