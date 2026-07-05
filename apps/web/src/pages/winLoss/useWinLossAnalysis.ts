// Data hook for the /win-loss retrospective page. Mirrors the response shape
// of GET /api/win-loss/analysis (schema lives inline in
// apps/api/src/routes/win-loss.ts next to the aggregate it validates).
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { WinLossOutcome, WinLossReasonCode } from '@bidstack/shared';

export interface WinLossAnalysisFilter {
  /** Inclusive YYYY-MM-DD lower bound on when the outcome was recorded. */
  from?: string;
  /** Inclusive YYYY-MM-DD upper bound. */
  to?: string;
  ownerId?: string;
}

// Type alias (not interface) on purpose: aliases carry the implicit index
// signature the charts' DataPoint (Record<string, unknown>) input requires.
export type WinLossQuarterBucket = {
  quarter: string;
  won: number;
  lost: number;
};

export interface WinLossReasonBucket {
  reason: WinLossReasonCode;
  won: number;
  lost: number;
}

export interface WinLossCompetitorBucket {
  competitor: string;
  won: number;
  lost: number;
}

export interface WinLossClosedRow {
  opportunityId: string;
  name: string;
  customer: string;
  outcome: WinLossOutcome;
  reason: WinLossReasonCode;
  competitor: string | null;
  /** BigInt-safe micros on the wire; format at the edge. */
  valueMicros: string;
  ownerId: string | null;
  ownerName: string | null;
  decidedAt: string;
}

export interface WinLossAnalysis {
  totalWon: number;
  totalLost: number;
  /** 0-100, one decimal; null when the range has no closed records. */
  winRatePct: number | null;
  quarters: WinLossQuarterBucket[];
  reasons: WinLossReasonBucket[];
  competitors: WinLossCompetitorBucket[];
  recent: WinLossClosedRow[];
}

function queryString(filter: WinLossAnalysisFilter): string {
  const params = new URLSearchParams();
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.ownerId) params.set('ownerId', filter.ownerId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useWinLossAnalysis(filter: WinLossAnalysisFilter = {}) {
  return useQuery({
    queryKey: ['win-loss-analysis', filter],
    queryFn: ({ signal }) =>
      api<WinLossAnalysis>(`/api/win-loss/analysis${queryString(filter)}`, { signal }),
  });
}
