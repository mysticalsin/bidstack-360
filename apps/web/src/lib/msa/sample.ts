// Labelled Sample data for the Agreements screens. Used only while the MSA API
// (/api/v1/msa…) is not deployed on this server; every screen that renders it
// shows a "Sample" banner. Dates are relative to today so the expiring-soon
// strip and notice deadlines stay meaningful.
import type {
  MsaAccountSummary, MsaDetail, MsaFileVersion, MsaKind, MsaListQuery, MsaListResponse, MsaStatus,
  MsaSummaryRow, MsaTimelineEvent, MsaUserRef,
} from './types';

const DAY = 86_400_000;
const CI = 'c0000000-0000-4000-8000-000000000001';
const owner: MsaUserRef = { id: '00000000-0000-4000-8000-0000000000a1', email: 'jane@mantu.com', name: 'Jane Smith' };
const legal: MsaUserRef = { id: '00000000-0000-4000-8000-0000000000a2', email: 'legal@mantu.com', name: 'Rita Legal' };

function iso(offsetDays: number, now: number): string {
  const d = new Date(now + offsetDays * DAY);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

interface Seed {
  id: string; companyId: string; companyName: string; parentId?: string; kind: MsaKind; title: string; reference: string;
  status: MsaStatus; effective: number | null; expiry: number | null; autoRenew?: boolean; notice?: number | null;
  tags?: string[]; file?: { name: string; docx?: boolean; kb: number; versions?: number };
  governingLaw?: string; capMillions?: number; paymentTerms?: string; countries?: string[];
}

const SEEDS: Seed[] = [
  { id: 'a0000000-0000-4000-8000-000000000101', companyId: CI, companyName: 'CI Financial', kind: 'msa', title: 'Master services agreement', reference: 'CIF-MSA-2023', status: 'active', effective: -900, expiry: 74, autoRenew: true, notice: 90, tags: ['strategic'], file: { name: 'CIF-MSA-2023-signed.pdf', kb: 1840, versions: 3 }, governingLaw: 'Ontario, Canada', capMillions: 5, paymentTerms: 'Net 45 from invoice', countries: ['CA', 'US'] },
  { id: 'a0000000-0000-4000-8000-000000000102', companyId: CI, companyName: 'CI Financial', parentId: 'a0000000-0000-4000-8000-000000000101', kind: 'sow', title: 'SOW 7 — Legacy app retirement', reference: 'CIF-SOW-07', status: 'active', effective: -120, expiry: 21, notice: 14, file: { name: 'CIF-SOW-07.pdf', kb: 620 } },
  { id: 'a0000000-0000-4000-8000-000000000103', companyId: CI, companyName: 'CI Financial', parentId: 'a0000000-0000-4000-8000-000000000101', kind: 'sow', title: 'SOW 8 — Security operations uplift', reference: 'CIF-SOW-08', status: 'in_negotiation', effective: null, expiry: null, file: { name: 'CIF-SOW-08-draft.docx', docx: true, kb: 210 } },
  { id: 'a0000000-0000-4000-8000-000000000104', companyId: CI, companyName: 'CI Financial', parentId: 'a0000000-0000-4000-8000-000000000101', kind: 'amendment', title: 'Amendment 2 — Rate card 2026', reference: 'CIF-AMD-02', status: 'active', effective: -60, expiry: 74, file: { name: 'CIF-AMD-02.pdf', kb: 180 } },
  { id: 'a0000000-0000-4000-8000-000000000105', companyId: CI, companyName: 'CI Financial', kind: 'nda', title: 'Mutual NDA', reference: 'CIF-NDA-2022', status: 'expired', effective: -1300, expiry: -200, file: { name: 'CIF-NDA.pdf', kb: 95 } },
  { id: 'a0000000-0000-4000-8000-000000000201', companyId: 'c0000000-0000-4000-8000-000000000002', companyName: 'DNB Bank', kind: 'framework', title: 'IT consultancy framework', reference: 'DNB-FW-2024', status: 'active', effective: -400, expiry: 38, notice: 60, tags: ['public-tender'], file: { name: 'DNB-framework.pdf', kb: 2400, versions: 2 }, governingLaw: 'Norway', capMillions: 20, paymentTerms: 'Net 30', countries: ['NO'] },
  { id: 'a0000000-0000-4000-8000-000000000202', companyId: 'c0000000-0000-4000-8000-000000000002', companyName: 'DNB Bank', parentId: 'a0000000-0000-4000-8000-000000000201', kind: 'sow', title: 'Call-off 3 — Payments modernisation', reference: 'DNB-CO-03', status: 'active', effective: -90, expiry: 180, file: { name: 'DNB-CO-03.pdf', kb: 540 } },
  { id: 'a0000000-0000-4000-8000-000000000301', companyId: 'c0000000-0000-4000-8000-000000000003', companyName: 'MAHLE', kind: 'msa', title: 'Engineering services MSA', reference: 'MAH-MSA-2025', status: 'pending', effective: null, expiry: null, tags: ['renewal'], file: { name: 'MAHLE-MSA-v4.docx', docx: true, kb: 330, versions: 4 }, governingLaw: 'Germany', capMillions: 10, countries: ['DE'] },
  { id: 'a0000000-0000-4000-8000-000000000401', companyId: 'c0000000-0000-4000-8000-000000000004', companyName: 'Acme Corp', kind: 'msa', title: 'Professional services MSA', reference: 'ACM-MSA-2021', status: 'active', effective: -1500, expiry: 320, autoRenew: true, notice: 120, file: { name: 'ACME-MSA.pdf', kb: 1200 }, governingLaw: 'England and Wales', capMillions: 2, paymentTerms: 'Net 60', countries: ['GB'] },
  { id: 'a0000000-0000-4000-8000-000000000501', companyId: 'c0000000-0000-4000-8000-000000000005', companyName: 'Northwind', kind: 'msa', title: 'Managed services agreement', reference: 'NW-MSA-2022', status: 'draft', effective: null, expiry: null },
];

function versionsFor(s: Seed, now: number): MsaFileVersion[] {
  if (!s.file) return [];
  const n = s.file.versions ?? 1;
  return Array.from({ length: n }, (_, i) => ({
    id: `${s.id.slice(0, -3)}${(900 + i).toString()}`,
    versionNo: i + 1,
    fileName: i === n - 1 ? s.file!.name : s.file!.name.replace(/(\.\w+)$/, `-v${i + 1}$1`),
    contentType: s.file!.docx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
    bytes: Math.round(s.file!.kb * 1024 * (0.9 + i * 0.05)),
    sha256: (s.id.replace(/-/g, '') + 'f'.repeat(64)).slice(0, 64),
    note: i === n - 1 ? (n > 1 ? 'Signed copy' : null) : `Draft ${i + 1}`,
    extractionStatus: 'done',
    createdBy: i === n - 1 ? legal : owner,
    createdAt: iso((s.effective ?? -30) - (n - 1 - i) * 14, now),
  }));
}

function toRow(s: Seed, now: number): MsaSummaryRow {
  const versions = versionsFor(s, now);
  const expiryDate = s.expiry == null ? null : iso(s.expiry, now);
  const notice = s.notice ?? null;
  return {
    id: s.id, companyId: s.companyId, companyName: s.companyName, parentId: s.parentId ?? null, kind: s.kind,
    title: s.title, reference: s.reference, counterparty: s.companyName, status: s.status,
    effectiveDate: s.effective == null ? null : iso(s.effective, now), expiryDate,
    autoRenew: Boolean(s.autoRenew), noticePeriodDays: notice,
    noticeDeadline: expiryDate && notice != null ? iso((s.expiry ?? 0) - notice, now) : null,
    daysToExpiry: s.expiry, owner, tags: s.tags ?? [],
    childCount: SEEDS.filter((c) => c.parentId === s.id).length,
    latestVersion: versions.at(-1) ?? null, updatedAt: versions.at(-1)?.createdAt ?? iso(-3, now),
  };
}

/** Sample rows; companyId/companyName remap the CI Financial set onto another account. */
export function sampleRows(now = Date.now(), account?: { id: string; name: string }): MsaSummaryRow[] {
  return SEEDS.map((s) => {
    const r = toRow(s, now);
    if (account && account.id !== CI && s.companyId === CI) return { ...r, companyId: account.id, companyName: account.name, counterparty: account.name };
    return r;
  });
}

export function filterRows(rows: MsaSummaryRow[], q: MsaListQuery): MsaSummaryRow[] {
  const needle = q.q?.trim().toLowerCase();
  const out = rows.filter((r) => {
    if ((q.topLevel ?? 'true') === 'true' && !q.parentId && r.parentId) return false;
    if (q.parentId && r.parentId !== q.parentId) return false;
    if (q.companyId && r.companyId !== q.companyId) return false;
    if (q.status?.length && !q.status.includes(r.status)) return false;
    if (q.kind?.length && !q.kind.includes(r.kind)) return false;
    if (q.tag && !r.tags.includes(q.tag)) return false;
    if (q.expiringWithinDays != null && (r.daysToExpiry == null || r.daysToExpiry < 0 || r.daysToExpiry > q.expiringWithinDays)) return false;
    if (needle && !`${r.title} ${r.reference} ${r.counterparty ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const sort = q.sort ?? 'expiry';
  return out.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
    return (a.daysToExpiry ?? Number.MAX_SAFE_INTEGER) - (b.daysToExpiry ?? Number.MAX_SAFE_INTEGER);
  });
}

export function sampleList(q: MsaListQuery, now = Date.now()): MsaListResponse {
  const items = filterRows(sampleRows(now), q);
  return { items, nextCursor: null, total: items.length };
}

export function sampleDetail(id: string, now = Date.now()): MsaDetail | null {
  const s = SEEDS.find((x) => x.id === id);
  if (!s) return null;
  const rows = sampleRows(now);
  const row = rows.find((r) => r.id === id)!;
  const parent = s.parentId ? rows.find((r) => r.id === s.parentId) ?? null : null;
  return {
    ...row,
    governingLaw: s.governingLaw ?? null,
    liabilityCap: s.capMillions ? { amountMicros: s.capMillions * 1e12, currency: 'EUR' } : null,
    paymentTerms: s.paymentTerms ?? null,
    notes: null,
    currency: 'EUR',
    countries: s.countries ?? [],
    parent: parent ? { id: parent.id, title: parent.title, kind: parent.kind } : null,
    children: rows.filter((r) => r.parentId === id),
    versions: versionsFor(s, now).reverse(),
    createdAt: iso((s.effective ?? -30) - 30, now),
  };
}

export function sampleTimeline(id: string, now = Date.now()): MsaTimelineEvent[] {
  const d = sampleDetail(id, now);
  if (!d) return [];
  const ev: MsaTimelineEvent[] = [{ id: `${id}-created`, at: d.createdAt, kind: 'audit', action: 'msa.create', actor: owner, detail: {} }];
  for (const v of [...d.versions].reverse()) ev.push({ id: `${v.id}-up`, at: v.createdAt, kind: 'audit', action: 'msa.version.upload', actor: v.createdBy, detail: { versionNo: v.versionNo, fileName: v.fileName } });
  if (d.effectiveDate) ev.push({ id: `${id}-eff`, at: d.effectiveDate, kind: 'milestone', action: 'msa.effective', actor: null, detail: {} });
  if (d.noticeDeadline) ev.push({ id: `${id}-notice`, at: d.noticeDeadline, kind: 'milestone', action: 'msa.notice_deadline', actor: null, detail: { noticePeriodDays: d.noticePeriodDays } });
  if (d.expiryDate) ev.push({ id: `${id}-exp`, at: d.expiryDate, kind: 'milestone', action: d.autoRenew ? 'msa.renewal' : 'msa.expiry', actor: null, detail: { autoRenew: d.autoRenew } });
  return ev.sort((a, b) => b.at.localeCompare(a.at));
}

export function summarise(companyId: string, rows: MsaSummaryRow[]): MsaAccountSummary {
  const mine = rows.filter((r) => r.companyId === companyId);
  const top = mine.filter((r) => !r.parentId);
  const byStatus: Record<string, number> = {};
  for (const r of mine) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const live = mine.filter((r) => r.daysToExpiry != null && r.daysToExpiry >= 0 && r.status === 'active').sort((a, b) => a.daysToExpiry! - b.daysToExpiry!);
  const next = live[0];
  const notices = mine
    .filter((r) => r.noticeDeadline && r.status === 'active')
    .map((r) => ({ r, days: Math.round((Date.parse(r.noticeDeadline!) - Date.now()) / DAY) }))
    .filter((x) => x.days >= 0)
    .sort((a, b) => a.days - b.days);
  const primary = top.find((r) => r.kind === 'msa' || r.kind === 'framework') ?? top[0] ?? null;
  return {
    companyId,
    total: mine.length,
    byStatus,
    childCounts: {
      sow: mine.filter((r) => r.kind === 'sow').length,
      amendment: mine.filter((r) => r.kind === 'amendment').length,
      addendum: mine.filter((r) => r.kind === 'addendum').length,
    },
    primary,
    nextExpiry: next ? { id: next.id, title: next.title, date: next.expiryDate!, days: next.daysToExpiry! } : null,
    nextNoticeDeadline: notices[0] ? { id: notices[0].r.id, title: notices[0].r.title, date: notices[0].r.noticeDeadline!, days: notices[0].days } : null,
    expiringWithin90Days: live.filter((r) => r.daysToExpiry! <= 90).length,
  };
}

export function sampleSummary(companyId: string, companyName?: string, now = Date.now()): MsaAccountSummary {
  return summarise(companyId, sampleRows(now, companyName ? { id: companyId, name: companyName } : undefined));
}
