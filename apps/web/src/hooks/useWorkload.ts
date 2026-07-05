import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface WorkloadOwner {
  /** null = the unassigned bucket (open bids/tasks nobody owns). */
  ownerId: string | null;
  /** null name+email with a non-null ownerId = a departed owner still holding bids. */
  name: string | null;
  email: string | null;
  openBids: number;
  /** Micros as strings — format at the edge with formatMoneyMicros. */
  openValueMicros: string;
  weightedValueMicros: string;
  openTasks: number;
  overdueTasks: number;
  closingWithin7Days: number;
}

export interface WorkloadResponse {
  generatedAt: string;
  owners: WorkloadOwner[];
}

/**
 * Per-owner team workload (open bids, weighted pipeline, overdue tasks,
 * bids closing within 7 days). Backs the WorkloadPage capacity table.
 */
export function useWorkload() {
  return useQuery({
    queryKey: ['analytics', 'workload'],
    queryFn: ({ signal }) => api<WorkloadResponse>('/api/analytics/workload', { signal }),
    // A Monday-morning triage screen must not show Friday's numbers when the
    // tab was left open — refresh on return like the opportunities list does.
    staleTime: 30_000,
    refetchOnMount: 'always',
  });
}
