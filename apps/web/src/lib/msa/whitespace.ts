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
