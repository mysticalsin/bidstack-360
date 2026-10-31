// Org chart API client (contract: /workspace/fleet/polo-orgchart-api.md).
// The page edits a local draft; Save replays the draft against the server as
// per-node mutations, each carrying the version from the last read. A 409
// version_conflict surfaces as OrgChartConflictError; "Overwrite with mine"
// refetches and replays again (the replay is idempotent against fresh state).
import type {
  OrgChartCoverage, OrgChartImportResult, OrgChartMutationResponse, OrgChartNode, OrgChartNodeDetail, OrgChartTreeResponse,
} from '@bidstack/shared';

import { api, ApiError } from '@/lib/api';

import { OrgChartConflictError, type OrgChart, type OrgNode } from './types';

const C = (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/org-chart`;
const N = (nodeId: string) => `/api/org-chart/nodes/${encodeURIComponent(nodeId)}`;

function asConflict(e: unknown): never {
  if (e instanceof ApiError && e.status === 409) {
    const b = (e.body ?? {}) as { error?: string; message?: string; currentVersion?: number | null; chartVersion?: number | null };
    if (b.error === 'version_conflict') {
      throw new OrgChartConflictError({ message: b.message ?? '', currentVersion: b.currentVersion ?? null, chartVersion: b.chartVersion ?? null });
    }
  }
  throw e;
}
const call = <T,>(p: Promise<T>) => p.catch(asConflict);

export function toOrgNode(n: OrgChartNode): OrgNode {
  return {
    id: n.id, parentId: n.parentId, name: n.name, title: n.title, photoUrl: n.photoUrl, seniority: n.seniority, region: n.region,
    contactId: n.contactId, email: null, ownerName: n.owner?.name ?? null, source: n.source, version: n.version, kind: n.kind,
    function: n.function, redacted: n.redacted, meetingCount: n.meetingCount, lastMetAt: n.lastMetAt, relationshipStrength: n.relationshipStrength,
  };
}

export function toOrgChart(t: OrgChartTreeResponse): OrgChart | null {
  if (!t.chart || t.nodes.length === 0) return null;
  return {
    companyId: t.companyId, rootId: t.chart.rootNodeId, version: t.chart.version, updatedAt: t.chart.updatedAt, updatedBy: null,
    sample: false, truncated: t.truncated, nodes: t.nodes.map(toOrgNode),
  };
}

export const fetchOrgChart = (companyId: string, signal?: AbortSignal) =>
  api<OrgChartTreeResponse>(C(companyId), { signal }).then(toOrgChart);
export const fetchOrgChartCoverage = (companyId: string, signal?: AbortSignal) =>
  api<OrgChartCoverage>(`${C(companyId)}/coverage`, { signal });
export const fetchOrgChartNode = (nodeId: string, signal?: AbortSignal) => api<OrgChartNodeDetail>(N(nodeId), { signal });

export const importOrgChartCsv = (companyId: string, csv: string, dryRun: boolean, chartVersion?: number) =>
  call(api<OrgChartImportResult>(`${C(companyId)}/import`, { method: 'POST', body: { csv, dryRun, ...(chartVersion !== undefined ? { chartVersion } : {}) } }))
    .catch((e: unknown) => {
      // 422 carries the same result shape (line errors, nothing written).
      if (e instanceof ApiError && e.status === 422 && e.body && typeof e.body === 'object' && 'errors' in e.body) return e.body as OrgChartImportResult;
      throw e;
    });
export const seedOrgChart = (companyId: string, opts: { includeApollo: boolean; includeMeetingAttendees: boolean }) =>
  api<{ queued: boolean; jobId: string | null }>(`${C(companyId)}/seed`, { method: 'POST', body: opts });

/** The mutation surface the replay needs (injected for tests). */
export interface OrgChartOps {
  create(companyId: string, body: Record<string, unknown>): Promise<OrgChartMutationResponse>;
  patch(nodeId: string, body: Record<string, unknown>): Promise<OrgChartMutationResponse>;
  move(nodeId: string, body: { version: number; parentId: string }): Promise<OrgChartMutationResponse>;
  remove(nodeId: string, version: number): Promise<OrgChartMutationResponse>;
  setRoot(companyId: string, body: { nodeId: string; chartVersion: number }): Promise<OrgChartMutationResponse>;
  fetch(companyId: string): Promise<OrgChart | null>;
}

export const apiOps: OrgChartOps = {
  create: (companyId, body) => call(api(`${C(companyId)}/nodes`, { method: 'POST', body })),
  patch: (nodeId, body) => call(api(N(nodeId), { method: 'PATCH', body })),
  move: (nodeId, body) => call(api(`${N(nodeId)}/move`, { method: 'POST', body })),
  remove: (nodeId, version) => call(api(`${N(nodeId)}?version=${version}`, { method: 'DELETE' })),
  setRoot: (companyId, body) => call(api(`${C(companyId)}/root`, { method: 'POST', body })),
  fetch: (companyId) => fetchOrgChart(companyId),
};

const FIELDS = ['name', 'title', 'seniority', 'region', 'photoUrl', 'relationshipStrength'] as const;
type Field = (typeof FIELDS)[number];
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null);

function fieldsOf(n: OrgNode, sampleSave: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const v = blank(n[f]);
    if (v !== null) out[f] = v;
  }
  // Sample people are invented: save them as role placeholders, never as names.
  if (sampleSave && n.source === 'sample') out.name = n.title || 'Unknown role';
  if (n.contactId && !sampleSave) out.contactId = n.contactId;
  if (sampleSave && n.contactId && n.source !== 'sample') out.contactId = n.contactId;
  return out;
}

export interface ReplayResult { chart: OrgChart | null; created: number; changed: number; skipped: string[]; idMap: Map<string, string> }

/**
 * Make the server match the draft for everything the user touched relative
 * to `base`: creates (parents first), root, moves, field patches, deletes.
 * Steps already reflected on the server are skipped, so a retry after a 409
 * does not duplicate work. `idMap` carries draft-id -> server-id across retries.
 */
export async function replayDraft(
  companyId: string, base: OrgChart, draft: { nodes: OrgNode[]; rootId: string | null }, ops: OrgChartOps = apiOps,
  idMap = new Map<string, string>(), mode: 'strict' | 'overwrite' = 'strict',
): Promise<ReplayResult> {
  const sampleSave = base.sample;
  const baseById = new Map(base.sample ? [] : base.nodes.map((n) => [n.id, n]));
  // Strict: send the versions the user last read, so a stale write gets a 409.
  // Overwrite: refetch and reapply on top of whatever is there now.
  let server = mode === 'overwrite' ? await ops.fetch(companyId) : base.sample ? null : base;
  let byId = new Map((server?.nodes ?? []).map((n) => [n.id, n]));
  let chartVersion = server?.version ?? 0;
  const ver = (id: string) => byId.get(id)?.version ?? 0;
  const real = (id: string | null) => (id ? idMap.get(id) ?? (byId.has(id) ? id : null) : null);
  const note = (r: OrgChartMutationResponse) => {
    chartVersion = r.chartVersion;
    if (r.node) byId.set(r.node.id, { ...(byId.get(r.node.id) ?? ({} as OrgNode)), ...toOrgNode(r.node) });
  };
  const skipped: string[] = [];
  let created = 0;
  let changed = 0;

  // Draft order, parents before children.
  const kids = new Map<string | null, OrgNode[]>();
  for (const n of draft.nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const order: OrgNode[] = [];
  const walk = (id: string | null) => { for (const c of kids.get(id) ?? []) { order.push(c); walk(c.id); } };
  walk(null);
  for (const n of draft.nodes) if (!order.includes(n)) order.push(n);

  // 1. creates
  for (const n of order) {
    if (baseById.has(n.id) || idMap.has(n.id)) continue;
    const empty = byId.size === 0;
    const parent = real(n.parentId) ?? (empty ? null : real(draft.rootId) ?? server?.rootId ?? [...byId.keys()][0] ?? null);
    if (!empty && !parent) { skipped.push(`${n.name}: manager not saved`); continue; }
    const r = await ops.create(companyId, { ...fieldsOf(n, sampleSave), parentId: empty ? null : parent, chartVersion });
    note(r);
    if (r.node) { idMap.set(n.id, r.node.id); created++; }
  }

  // 2. root
  const wantRoot = real(draft.rootId);
  const curRoot = [...byId.values()].find((n) => n.parentId === null)?.id ?? null;
  if (wantRoot && curRoot && wantRoot !== curRoot) {
    note(await ops.setRoot(companyId, { nodeId: wantRoot, chartVersion }));
    changed++;
    server = await ops.fetch(companyId);
    byId = new Map((server?.nodes ?? []).map((n) => [n.id, n]));
  }

  // 3. moves and 4. patches, top-down
  const draftIds = new Set(draft.nodes.map((n) => n.id));
  for (const n of order) {
    const id = real(n.id);
    if (!id) continue;
    const cur = byId.get(id);
    if (!cur || cur.redacted) { if (!cur) skipped.push(`${n.name}: no longer on the chart`); continue; }
    const was = baseById.get(n.id);
    const wantParent = real(n.parentId);
    const parentTouched = !was || was.parentId !== n.parentId;
    if (parentTouched && wantParent && cur.parentId !== wantParent && id !== wantRoot) {
      note(await ops.move(id, { version: ver(id), parentId: wantParent }));
      changed++;
    }
    if (!was) continue; // created with its fields already
    const body: Record<string, unknown> = {};
    for (const f of FIELDS as readonly Field[]) {
      const a = blank(was[f]);
      const b = blank(n[f]);
      if (a !== b && blank(byId.get(id)?.[f]) !== b) body[f] = b;
    }
    if (Object.keys(body).length) {
      note(await ops.patch(id, { ...body, version: ver(id) }));
      changed++;
    }
  }

  // 5. deletes, deepest first (their reports already moved)
  const gone = [...baseById.values()].filter((n) => !draftIds.has(n.id)).sort((a, b) => depth(base.nodes, b.id) - depth(base.nodes, a.id));
  for (const n of gone) {
    if (!byId.has(n.id)) continue;
    note(await ops.remove(n.id, ver(n.id)));
    byId.delete(n.id);
    changed++;
  }

  return { chart: await ops.fetch(companyId), created, changed, skipped, idMap };
}

function depth(nodes: OrgNode[], id: string): number {
  const by = new Map(nodes.map((n) => [n.id, n]));
  let d = 0;
  for (let p = by.get(id)?.parentId; p && d < 1000; p = by.get(p)?.parentId) d++;
  return d;
}
