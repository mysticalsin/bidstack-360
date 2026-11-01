// Pure helpers for the Agreements list: headline numbers and URL filters.
import { filterRows } from '@/lib/msa/sample';
import { MSA_KINDS, MSA_STATUSES, type MsaKind, type MsaListQuery, type MsaStatus, type MsaSummaryRow } from '@/lib/msa/types';

export type AgreementsView = 'active' | 'expiring' | 'notice' | 'open';

/** Pure: the four headline numbers, from the full (unfiltered) list. */
export function headline(rows: MsaSummaryRow[], now = Date.now()) {
  const live = rows.filter((r) => r.status === 'active');
  const in30 = now + 30 * 86_400_000;
  return {
    active: live.length,
    expiring: live.filter((r) => r.daysToExpiry != null && r.daysToExpiry >= 0 && r.daysToExpiry <= 90).length,
    notice: live.filter((r) => r.noticeDeadline && Date.parse(r.noticeDeadline) >= now - 86_400_000 && Date.parse(r.noticeDeadline) <= in30).length,
    open: rows.filter((r) => r.status === 'draft' || r.status === 'in_negotiation' || r.status === 'pending').length,
  };
}

/** Pure: apply URL params (incl. headline view) to the rows. */
export function applyView(rows: MsaSummaryRow[], p: URLSearchParams, now = Date.now()): MsaSummaryRow[] {
  const view = p.get('view') as AgreementsView | null;
  const status = p.getAll('status').filter((s): s is MsaStatus => (MSA_STATUSES as readonly string[]).includes(s));
  const kind = p.getAll('kind').filter((k): k is MsaKind => (MSA_KINDS as readonly string[]).includes(k));
  const within = p.get('within');
  const q: MsaListQuery = {
    q: p.get('q') ?? undefined,
    companyId: p.get('companyId') ?? undefined,
    status: status.length ? status : undefined,
    kind: kind.length ? kind : undefined,
    expiringWithinDays: within ? Number(within) : undefined,
    // Searching or narrowing by type should find SOWs/amendments too.
    topLevel: p.get('q') || kind.length || view ? 'false' : 'true',
    sort: (p.get('sort') as MsaListQuery['sort']) ?? 'expiry',
  };
  let out = filterRows(rows, q);
  if (view === 'active') out = out.filter((r) => r.status === 'active');
  if (view === 'expiring') out = out.filter((r) => r.status === 'active' && r.daysToExpiry != null && r.daysToExpiry >= 0 && r.daysToExpiry <= 90);
  if (view === 'notice') out = out.filter((r) => r.status === 'active' && r.noticeDeadline && Date.parse(r.noticeDeadline) >= now - 86_400_000 && Date.parse(r.noticeDeadline) <= now + 30 * 86_400_000);
  if (view === 'open') out = out.filter((r) => r.status === 'draft' || r.status === 'in_negotiation' || r.status === 'pending');
  if (p.get('leverage') === '1') out = out.filter((r) => r.underLeveraged);
  return out;
}
