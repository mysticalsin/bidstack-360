// Org chart data for one account: the live chart and coverage from the org
// chart API, plus meeting-intel attendees (for the Sample structure shown
// before anyone charts the account, and as the "our owner" fallback).
import type { MeetingIntelDetail } from '@bidstack/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useMeetingDetails, useMeetingList } from '@/hooks/useMeetingIntel';
import { fetchOrgChart, fetchOrgChartCoverage, fetchOrgChartNode } from '@/lib/orgchart/client';
import { coverageFor, coverageFromMeetings, covFromPerson } from '@/lib/orgchart/coverage';
import { sampleChart } from '@/lib/orgchart/sample';
import { normalise } from '@/lib/orgchart/tree';
import type { NodeCov, OrgChart, OrgNode } from '@/lib/orgchart/types';

const MAX_DETAILS = 30;
export const orgChartKey = (companyId: string | undefined) => ['orgchart', companyId] as const;

export function useOrgChart(companyId: string | undefined) {
  const saved = useQuery({
    queryKey: orgChartKey(companyId),
    queryFn: ({ signal }) => fetchOrgChart(companyId!, signal),
    enabled: Boolean(companyId),
    staleTime: 0,
  });
  const live = Boolean(saved.data);
  const cov = useQuery({
    queryKey: ['orgchart', companyId, 'coverage', saved.data?.version],
    queryFn: ({ signal }) => fetchOrgChartCoverage(companyId!, signal),
    enabled: live,
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
    if (saved.data) return { ...saved.data, ...normalise(saved.data.nodes, saved.data.rootId) };
    if (list.isLoading || !detailsDone) return null;
    return sampleChart(companyId, people);
  }, [companyId, saved.isLoading, saved.data, list.isLoading, detailsDone, people]);

  const metById = useMemo(() => new Map((cov.data?.nodes ?? []).map((n) => [n.nodeId, n])), [cov.data]);
  const unmetSenior = useMemo(() => new Set(cov.data?.unmetSenior ?? []), [cov.data]);

  /** Coverage for one person: the API's per-node numbers on a live chart, meeting intel on a Sample. */
  const covOf = useCallback((n: OrgNode): NodeCov | undefined => {
    const fromMeetings = covFromPerson(coverageFor(coverage, n));
    if (!live || n.meetingCount === undefined) return fromMeetings;
    const c = metById.get(n.id);
    const count = c?.meetingCount ?? n.meetingCount;
    return {
      met: c ? c.met : count > 0, count, lastMetAt: c?.lastMetAt ?? n.lastMetAt ?? null,
      meetings: fromMeetings?.meetings ?? [], challenges: fromMeetings?.challenges ?? [], owners: fromMeetings?.owners ?? [],
      manual: n.relationshipStrength ?? null,
    };
  }, [coverage, live, metById]);

  return {
    chart,
    coverage,
    covOf,
    people,
    unmetSenior,
    live,
    /** Reference "now" for strength, taken from data freshness (keeps render pure). */
    asOf: list.dataUpdatedAt || saved.dataUpdatedAt,
    isLoading: !chart,
    error: saved.error,
    meetingsError: list.error,
  };
}

export function useOrgChartNode(nodeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['orgchart-node', nodeId],
    queryFn: ({ signal }) => fetchOrgChartNode(nodeId!, signal),
    enabled: Boolean(nodeId) && enabled,
  });
}

export function useReloadOrgChart() {
  const qc = useQueryClient();
  return (companyId: string) => Promise.all([
    qc.invalidateQueries({ queryKey: orgChartKey(companyId) }),
    qc.invalidateQueries({ queryKey: ['orgchart-node'] }),
  ]);
}
