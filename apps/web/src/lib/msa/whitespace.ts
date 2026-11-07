import { api } from '@/lib/api';
import { fmtDate } from '@/lib/msa/labels';
import type {
  AgreementSource,
  AgreementSyncRun,
  RelationshipMap,
  WhitespaceDecisionResponse,
  WhitespaceFlag,
  WhitespaceListResponse,
} from '@bidstack/shared';

export interface WhitespaceFilters {
  line?: string;
  signingEntityId?: string;
  country?: string;
  ownerId?: string;
  companyId?: string;
  state?: 'new' | 'accepted' | 'dismissed' | 'all';
  limit?: number;
}

export function whitespaceQuery(f: WhitespaceFilters): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function fetchWhitespace(f: WhitespaceFilters, signal?: AbortSignal) {
  return api<WhitespaceListResponse>(`/api/msa/whitespace${whitespaceQuery(f)}`, { signal });
}

export function fetchMsaWhitespace(msaId: string, signal?: AbortSignal) {
  return api<{ flag: WhitespaceFlag | null }>(`/api/msa/${msaId}/whitespace`, { signal });
}

export function acceptWhitespace(msaId: string, body: { line: string; ownerId: string; dueDate: string; createOpportunity: boolean }) {
  return api<WhitespaceDecisionResponse>(`/api/msa/${msaId}/whitespace/accept`, { method: 'POST', body });
}

export function dismissWhitespace(msaId: string, body: { line: string; reason: string }) {
  return api<WhitespaceDecisionResponse>(`/api/msa/${msaId}/whitespace/dismiss`, { method: 'POST', body });
}

export function fetchRelationshipMap(companyId: string, signal?: AbortSignal) {
  return api<RelationshipMap>(`/api/companies/${companyId}/relationship-map`, { signal });
}

export function fetchAgreementSources(signal?: AbortSignal) {
  return api<{ items: AgreementSource[] }>('/api/msa/sources', { signal });
}

export function syncAgreementSource(id: string) {
  return api<AgreementSyncRun>(`/api/msa/sources/${id}/sync`, { method: 'POST' });
}

export function lastRunText(s: AgreementSource): string {
  const run = s.lastRun;
  if (!run) return s.lastSyncAt ? `Last sync ${fmtDate(s.lastSyncAt)}` : 'Never synced';
  if (run.state === 'queued') return 'Queued';
  if (run.state === 'running') return 'Syncing';
  const r = run.result;
  const counts = r ? `${r.new} new · ${r.updated} updated · ${r.skipped} skipped${r.failed ? ` · ${r.failed} failed` : ''}` : '';
  const when = run.finishedAt ? fmtDate(run.finishedAt) : '';
  if (run.state === 'failed') return `Failed ${when}${run.reasons[0] ? ` · ${run.reasons[0]}` : ''}`;
  return `Last sync ${when}${counts ? ` · ${counts}` : ''}`;
}

export interface WhoRow {
  key: string;
  entity: string | null;
  line: string | null;
  owners: string[];
  lastActivityAt: string | null;
  valueMicros: number;
  currency: string | null;
}

const WORK_KINDS = new Set(['msa', 'opportunity', 'project', 'revenue']);

export function whoRows(map: RelationshipMap): WhoRow[] {
  const groups = new Map<string, WhoRow>();
  const all = Array.isArray(map.rows) ? map.rows : [];
  for (const r of all) {
    if (!WORK_KINDS.has(r.kind)) continue;
    const key = `${r.entity ?? ''}|${r.line ?? ''}`;
    const g = groups.get(key) ?? { key, entity: r.entity, line: r.line, owners: [], lastActivityAt: null, valueMicros: 0, currency: null };
    if (r.owner && !g.owners.includes(r.owner.name)) g.owners.push(r.owner.name);
    if (r.lastActivityAt && (!g.lastActivityAt || r.lastActivityAt > g.lastActivityAt)) g.lastActivityAt = r.lastActivityAt;
    if (r.valueMicros && (!g.currency || g.currency === r.currency)) {
      g.valueMicros += r.valueMicros;
      g.currency = r.currency;
    }
    groups.set(key, g);
  }
  for (const a of all) {
    if (a.kind !== 'activity' || !a.lastActivityAt) continue;
    for (const g of groups.values()) {
      if (g.line === a.line && (!g.lastActivityAt || a.lastActivityAt > g.lastActivityAt)) g.lastActivityAt = a.lastActivityAt;
    }
  }
  return [...groups.values()].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
}
