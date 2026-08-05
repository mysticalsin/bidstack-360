// URL state + selection semantics for the Proposals surface (ROUND2-ULTRAPLAN
// Phase 2, commit 2 — "table-kit density + URL state").
//
// WHY this file exists next to the page rather than inside it: everything here
// is pure. The parsers are declared once (`createListSearchParams`), and the
// predicates/comparator/pager that turn a URL into a visible page of rows are
// plain functions — unit-testable, and they keep ProposalsPage presentational.
//
// ── WHAT THE SERVER DOES AND WHAT THIS DOES, AND WHY ────────────────────────
// GET /api/v1/proposals (ProposalFilter, packages/shared/src/schemas/proposal.ts:60)
// accepts ONLY: status, opportunityId, search, limit (max 100), offset. There is
// no sort param, no owner param, no deadline param. This retarget is a
// PRESENTATION change — the API contract is not touched — so the surface fetches
// one bounded window (the 100 most recently updated proposals matching the stage
// tab + search) and does facet filtering, sorting and pagination over it here.
// The page renders a truncation notice whenever the server's `total` exceeds the
// loaded window, so the ceiling is stated on screen rather than hidden. Lifting
// it is a Round-3 API change (sort + facet params on ProposalFilter), not a
// silent client-side guess.

import type { ProposalStatus } from '@/components/rfp/shared/ProposalStatusChip';
import type { StatusTone } from '@/components/table-kit/status-indicator';
import {
  ALL_SEGMENT,
  createListSearchParams,
  type ListInput,
} from '@/lib/table/list-search-params';
import type { SortDirection } from '@/lib/table/table-query';

/** The API's hard ceiling on one page of proposals (ProposalFilter.limit max). */
export const PROPOSALS_WINDOW = 100;

export const PROPOSAL_STAGES: readonly ProposalStatus[] = [
  'draft',
  'review',
  'approved',
  'submitted',
  'won',
  'lost',
];

/**
 * Stage → dot tone. A dot plus the word, never a coloured pill: at table density
 * one badge per row turns the grid into confetti (status-indicator.tsx:17-19).
 */
export const STAGE_TONE: Record<ProposalStatus, StatusTone> = {
  draft: 'neutral',
  review: 'warning',
  approved: 'info',
  submitted: 'info',
  won: 'success',
  lost: 'error',
};

/** Deadline buckets. Exhaustive, so every row matches exactly one. */
export const DUE_WINDOWS = ['overdue', 'week', 'month', 'later', 'none'] as const;
export type DueWindow = (typeof DUE_WINDOWS)[number];

/** Compliance-score bands. `unscored` is neutral, never "bad" (ADR 0002). */
export const COMPLIANCE_BANDS = ['complete', 'partial', 'unscored'] as const;
export type ComplianceBand = (typeof COMPLIANCE_BANDS)[number];

/** Facet segment used for a proposal nobody owns. */
export const UNASSIGNED_OWNER = 'unassigned';

export type ProposalRow = {
  id: string;
  orgId: string;
  opportunityId: string | null;
  name: string;
  status: ProposalStatus;
  version: number;
  ownerId: string | null;
  complianceScore: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProposalPage = { items: ProposalRow[]; total: number };

export type ProposalFacetKey = 'owner' | 'dueWindow' | 'compliance';
export type ProposalListInput = ListInput<'status' | ProposalFacetKey>;

/**
 * `status` keeps the URL key the GlassCard version already used (`?status=draft`),
 * so every bookmark and the RFP hub's deep links keep working. Sorting defaults
 * to the server's own order (most recently updated first) so the first paint of
 * `/proposals` is byte-identical to what the API returned.
 */
export const proposalsSearchParams = createListSearchParams<'status', ProposalFacetKey>({
  tabId: 'status',
  facetIds: ['owner', 'dueWindow', 'compliance'],
  defaultSort: 'updated',
  defaultDir: 'desc',
  pageSize: 25,
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which deadline bucket a proposal sits in. Compared date-only: a bid due today
 * is "this week", not "overdue", whatever the clock says.
 */
export function dueWindowOf(dueDate: string | null, now: Date = new Date()): DueWindow {
  if (!dueDate) return 'none';
  const due = Date.parse(`${dueDate}T00:00:00`);
  if (Number.isNaN(due)) return 'none';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((due - today) / DAY_MS);
  if (days < 0) return 'overdue';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  return 'later';
}

export function complianceBandOf(score: number | null): ComplianceBand {
  if (score == null) return 'unscored';
  return score >= 90 ? 'complete' : 'partial';
}

function matchesSegment(value: string, segment: string): boolean {
  return segment === ALL_SEGMENT || value === segment;
}

function matchesOwner(row: ProposalRow, segment: string): boolean {
  if (segment === ALL_SEGMENT) return true;
  if (segment === UNASSIGNED_OWNER) return row.ownerId === null;
  return row.ownerId === segment;
}

/**
 * Free text over the loaded window. Bounded by design — the same `q` is also
 * sent to the API as `search`, so the window itself is already narrowed; this
 * pass only keeps the visible rows exact while a stale window is on screen
 * (keepPreviousData), instead of blanking the table for one round trip.
 */
function matchesQuery(row: ProposalRow, q: string): boolean {
  return q === '' || row.name.toLowerCase().includes(q.toLowerCase());
}

export type ProposalSortId = 'name' | 'stage' | 'owner' | 'compliance' | 'due' | 'updated';

/** Nulls sort last in BOTH directions — absence is not a small value. */
function compareNullable<T>(
  a: T | null,
  b: T | null,
  compare: (x: T, y: T) => number,
  dir: SortDirection,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === 'asc' ? compare(a, b) : compare(b, a);
}

const text = (a: string, b: string) => a.localeCompare(b);
const num = (a: number, b: number) => a - b;

function compareRows(
  a: ProposalRow,
  b: ProposalRow,
  sort: string,
  dir: SortDirection,
  ownerLabel: (id: string | null) => string | null,
): number {
  switch (sort as ProposalSortId) {
    case 'name':
      return dir === 'asc' ? text(a.name, b.name) : text(b.name, a.name);
    case 'stage':
      return compareNullable(
        PROPOSAL_STAGES.indexOf(a.status),
        PROPOSAL_STAGES.indexOf(b.status),
        num,
        dir,
      );
    case 'owner':
      return compareNullable(ownerLabel(a.ownerId), ownerLabel(b.ownerId), text, dir);
    case 'compliance':
      return compareNullable(a.complianceScore, b.complianceScore, num, dir);
    case 'due':
      return compareNullable(a.dueDate, b.dueDate, text, dir);
    case 'updated':
    default:
      return dir === 'asc' ? text(a.updatedAt, b.updatedAt) : text(b.updatedAt, a.updatedAt);
  }
}

export type ProposalSelection = {
  /** The rows for the requested page. */
  rows: ProposalRow[];
  /** How many rows survive the filters — what pagination counts. */
  total: number;
  /** Clamped page: a stale `?page=9` after a facet click lands on the last page. */
  page: number;
};

/**
 * Filter → sort → page, over the loaded window. Pure: the page hands it the URL
 * input and an owner-name resolver and renders the result.
 *
 * Paging here (rather than through the API's offset) is what makes a page change
 * a pure re-render with zero network — the "no blank table after first paint"
 * line of the density retarget, satisfied structurally rather than by a spinner.
 */
export function selectProposals(
  items: readonly ProposalRow[],
  input: ProposalListInput,
  ownerLabel: (id: string | null) => string | null,
  now: Date = new Date(),
): ProposalSelection {
  const filtered = items.filter(
    (row) =>
      matchesSegment(row.status, input.status) &&
      matchesOwner(row, input.owner) &&
      matchesSegment(dueWindowOf(row.dueDate, now), input.dueWindow) &&
      matchesSegment(complianceBandOf(row.complianceScore), input.compliance) &&
      matchesQuery(row, input.q),
  );

  const sorted = [...filtered].sort((a, b) =>
    compareRows(a, b, input.sort, input.dir, ownerLabel),
  );

  const lastPage = Math.max(1, Math.ceil(sorted.length / input.pageSize));
  const page = Math.min(input.page, lastPage);
  const start = (page - 1) * input.pageSize;

  return { rows: sorted.slice(start, start + input.pageSize), total: sorted.length, page };
}
