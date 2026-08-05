// The react-query adapter over the BidFact ledger's two human doors.
//
//   GET  /api/v1/bid-facts?subjectType=&subjectId=[&status=][&limit=]
//   POST /api/v1/bid-facts/:id/decide  { decision: 'accept' | 'dismiss' }
//
// Written against apps/api/src/routes/bid-facts.ts verbatim — the types below
// mirror its Zod response schemas field for field. BidStack has no tRPC, so the
// contract is re-declared here and nowhere else; every consumer imports from
// this file rather than re-typing a fetch.
//
// ── THE N+1, NAMED ──────────────────────────────────────────────────────────
// The list endpoint takes exactly ONE subject (`subjectId` is a required uuid),
// so a matrix showing 25 rows issues 25 requests for their PROPOSED facts, plus
// one more per row that already carries an answer (its APPLIED fact, which is
// what the provenance tooltip reads). That is why `ComplianceMatrix` paginates
// client-side at 25 rows and only ever asks for the visible page — the fan-out
// is bounded by pageSize, not by the 500-row matrix. The real fix is a batch
// `subjectIds=` parameter on the list route; it is deliberately NOT smuggled in
// here because the endpoint's contract tests are green against the current
// shape (ADR-0004 Decision 4) and widening `subjectId` to optional weakens them.
// Round 3 owns the batch endpoint.

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import { api } from '@/lib/api';

export const BID_FACT_STATUSES = ['PROPOSED', 'APPLIED', 'DISMISSED', 'SUPERSEDED'] as const;
export type BidFactStatus = (typeof BID_FACT_STATUSES)[number];

/** Mirrors the route's SUBJECT_TYPES. */
export type BidFactSubjectType = 'matrix_row' | 'requirement';

export interface BidFactCitation {
  id: string;
  sourceChunkId: string;
  quote: string;
  pageStart: number | null;
  pageEnd: number | null;
  /** Title of the BidDocument the cited chunk came from; null if unresolvable. */
  documentName: string | null;
}

export interface BidFact {
  id: string;
  opportunityId: string | null;
  subjectType: string;
  subjectId: string;
  /** The proposed answerDraft text. */
  claim: string;
  /** YES | NO | PARTIAL | NOT_APPLICABLE | GAP */
  verdict: string;
  /** 0-10000; null = no score exists. 0 is a real score, never a sentinel. */
  confidenceBps: number | null;
  /** VERIFIED | PROBABLE | POSSIBLE — null below POSSIBLE. */
  band: string | null;
  assessmentStatus: 'ASSESSED' | 'UNAVAILABLE' | 'PENDING';
  rationale: string | null;
  status: BidFactStatus;
  producedByAgentKey: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
  citations: BidFactCitation[];
}

export interface BidFactList {
  items: BidFact[];
  total: number;
}

export interface DecideResult {
  id: string;
  status: BidFactStatus;
  decidedAt: string;
  decidedByUserId: string;
  decisionId: string;
  matrixRowUpdated: boolean;
  supersededFactIds: string[];
}

/**
 * One key per (subject, status) pair. The status segment is last so an
 * invalidation of `['bid-facts', type, id]` clears every status for a subject —
 * which is exactly what a decide has to do (a fact moves PROPOSED → APPLIED).
 */
export function bidFactsKey(
  subjectType: BidFactSubjectType,
  subjectId: string,
  status?: BidFactStatus,
): QueryKey {
  return status
    ? ['bid-facts', subjectType, subjectId, status]
    : ['bid-facts', subjectType, subjectId];
}

function fetchBidFacts(
  subjectType: BidFactSubjectType,
  subjectId: string,
  status: BidFactStatus,
  signal?: AbortSignal,
): Promise<BidFactList> {
  const params = new URLSearchParams({ subjectType, subjectId, status });
  return api<BidFactList>(`/api/v1/bid-facts?${params.toString()}`, { signal });
}

// A proposal is written by a background worker, not by the person looking at
// the screen, so a 30s stale window is honest: it never shows a fact the user
// just decided (the mutation invalidates), and it stops 25 rows from
// re-requesting on every focus change.
const FACTS_STALE_MS = 30_000;

function factQueryOptions(
  subjectType: BidFactSubjectType,
  subjectId: string,
  status: BidFactStatus,
) {
  return {
    queryKey: bidFactsKey(subjectType, subjectId, status),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchBidFacts(subjectType, subjectId, status, signal),
    staleTime: FACTS_STALE_MS,
  };
}

/** Single-subject read — the shape a detail panel wants. */
export function useBidFacts(args: {
  subjectType: BidFactSubjectType;
  subjectId: string | null;
  status?: BidFactStatus;
}) {
  const { subjectType, subjectId, status = 'PROPOSED' } = args;
  return useQuery<BidFactList>({
    ...factQueryOptions(subjectType, subjectId ?? '', status),
    enabled: !!subjectId,
  });
}

/** What one matrix row needs: its live proposals and the fact behind its answer. */
export interface SubjectFacts {
  proposed: BidFact[];
  applied: BidFact[];
}

export interface FactSubjectRequest {
  subjectId: string;
  /** Ask for APPLIED only when the row already shows an answer — see the N+1 note. */
  wantApplied: boolean;
}

const EMPTY_SUBJECT_FACTS: SubjectFacts = { proposed: [], applied: [] };

export interface SubjectFactsResult {
  bySubject: Map<string, SubjectFacts>;
  /** Every fact fetched for this page, newest first — what AgentRationaleList renders. */
  all: BidFact[];
  isFetching: boolean;
}

/**
 * Facts for the rows currently on screen. One query per (row, status) pair;
 * see the N+1 note at the top of this file for why that is the shape and what
 * bounds it.
 */
export function useSubjectBidFacts(
  subjectType: BidFactSubjectType,
  subjects: readonly FactSubjectRequest[],
): SubjectFactsResult {
  const plan = subjects.flatMap((subject) => [
    { subjectId: subject.subjectId, status: 'PROPOSED' as const },
    ...(subject.wantApplied
      ? [{ subjectId: subject.subjectId, status: 'APPLIED' as const }]
      : []),
  ]);

  const results = useQueries({
    queries: plan.map((entry) => factQueryOptions(subjectType, entry.subjectId, entry.status)),
  });

  // Rebuilt every render on purpose: `plan` is capped at 2 × pageSize entries,
  // and the rows that consume it re-render with this component anyway, so a
  // memo would buy nothing and cost a dependency on react-query's result
  // identity (which changes on every background refetch).
  const bySubject = new Map<string, SubjectFacts>();
  const all: BidFact[] = [];
  plan.forEach((entry, index) => {
    const items = results[index]?.data?.items ?? [];
    const bucket = bySubject.get(entry.subjectId) ?? { proposed: [], applied: [] };
    if (entry.status === 'PROPOSED') bucket.proposed = items;
    else bucket.applied = items;
    bySubject.set(entry.subjectId, bucket);
    all.push(...items);
  });
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { bySubject, all, isFetching: results.some((result) => result.isFetching) };
}

export function subjectFactsFor(
  bySubject: Map<string, SubjectFacts>,
  subjectId: string,
): SubjectFacts {
  return bySubject.get(subjectId) ?? EMPTY_SUBJECT_FACTS;
}

export interface DecideVariables {
  factId: string;
  decision: 'accept' | 'dismiss';
  subjectId: string;
}

/**
 * Accept or dismiss one proposal.
 *
 * Optimistic on the PROPOSED list only: the strip has to collapse under the
 * click, and a failed decide must put it back rather than leave a ghost. The
 * APPLIED list and the compliance matrix are INVALIDATED instead of patched —
 * the server owns whether the write actually landed on the row (it can 409 on a
 * human edit, bid-facts.ts:findHumanAnswerEdit), and inventing an applied fact
 * client-side would render a receipt for a write that never happened.
 */
export function useDecideBidFact(args: {
  subjectType: BidFactSubjectType;
  /** Opportunity id — the compliance query key's middle segment. */
  workspaceId: string | null;
}) {
  const { subjectType, workspaceId } = args;
  const queryClient = useQueryClient();

  return useMutation<DecideResult, Error, DecideVariables, { previous: BidFactList | undefined }>({
    mutationFn: ({ factId, decision }) =>
      api<DecideResult>(`/api/v1/bid-facts/${factId}/decide`, {
        method: 'POST',
        body: { decision },
      }),
    onMutate: async ({ factId, subjectId }) => {
      const key = bidFactsKey(subjectType, subjectId, 'PROPOSED');
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<BidFactList>(key);
      if (previous) {
        queryClient.setQueryData<BidFactList>(key, {
          items: previous.items.filter((fact) => fact.id !== factId),
          total: Math.max(0, previous.total - 1),
        });
      }
      return { previous };
    },
    onError: (_error, { subjectId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(bidFactsKey(subjectType, subjectId, 'PROPOSED'), context.previous);
      }
    },
    onSettled: (_data, _error, { subjectId }) => {
      void queryClient.invalidateQueries({ queryKey: bidFactsKey(subjectType, subjectId) });
      if (workspaceId) {
        void queryClient.invalidateQueries({ queryKey: ['rfp', workspaceId, 'compliance'] });
      }
    },
  });
}
