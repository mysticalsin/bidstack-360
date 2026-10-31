// Org chart data for one account: the saved chart (mock store until the API
// lands), real meeting-intel coverage, and a Sample structure when nobody
// has charted the account yet.
import type { MeetingIntelDetail } from '@bidstack/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useMeetingDetails, useMeetingList } from '@/hooks/useMeetingIntel';
import { fetchOrgChart, saveOrgChart } from '@/lib/orgchart/client';
import { coverageFromMeetings } from '@/lib/orgchart/coverage';
import { sampleChart } from '@/lib/orgchart/sample';
import { normalise } from '@/lib/orgchart/tree';
import type { OrgChart } from '@/lib/orgchart/types';

const MAX_DETAILS = 30;

export function useOrgChart(companyId: string | undefined) {
  const saved = useQuery({
    queryKey: ['orgchart', companyId],
    queryFn: () => fetchOrgChart(companyId!),
    enabled: Boolean(companyId),
    staleTime: 0,
  });
  const list = useMeetingList({ groupId: companyId, limit: 50 } as Parameters<typeof useMeetingList>[0], Boolean(companyId));
  const ids = useMemo(() => (list.data?.items ?? []).slice(0, MAX_DETAILS).map((m) => m.id), [list.data]);
  const details = useMeetingDetails(ids);
  const detailsDone = details.every((d) => !d.isLoading);
  const stamp = details.map((d) => d.dataUpdatedAt).join(',');
  const meetings = useMemo(
    () => details.map((d) => d.data).filter((d): d is MeetingIntelDetail => Boolean(d)),
    // `details` is a new array every render; its fetch stamps are the real identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stamp],
  );
  const coverage = useMemo(() => coverageFromMeetings(meetings), [meetings]);
  const people = useMemo(() => [...new Set(coverage.values())], [coverage]);

  const chart: OrgChart | null = useMemo(() => {
    if (!companyId || saved.isLoading) return null;
    if (saved.data) {
      const n = normalise(saved.data.nodes, saved.data.rootId);
      return { ...saved.data, ...n };
    }
    if (list.isLoading || !detailsDone) return null;
    return sampleChart(companyId, people);
  }, [companyId, saved.isLoading, saved.data, list.isLoading, detailsDone, people]);

  return {
    chart,
    coverage,
    people,
    /** Reference "now" for strength, taken from data freshness (keeps render pure). */
    asOf: list.dataUpdatedAt || saved.dataUpdatedAt,
    isLoading: !chart,
    meetingsError: list.error,
  };
}

export function useSaveOrgChart() {
  const qc = useQueryClient();
  return async (chart: OrgChart, baseVersion: number, by: string) => {
    const next = await saveOrgChart(chart, baseVersion, by);
    qc.setQueryData(['orgchart', chart.companyId], next);
    return next;
  };
}

export function useReloadOrgChart() {
  const qc = useQueryClient();
  return (companyId: string) => qc.invalidateQueries({ queryKey: ['orgchart', companyId] });
}
