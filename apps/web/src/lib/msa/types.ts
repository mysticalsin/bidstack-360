// Local copy of the MSA library contract (packages/shared/src/schemas/msa.ts on
// polo/backend-hardening, commit 5b801a91). Types only: once that branch is
// merged these can be re-exported from @bidstack/shared instead.
export const MSA_MAX_BYTES = 25 * 1024 * 1024;
export const MSA_ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export type MsaContentType = (typeof MSA_ALLOWED_CONTENT_TYPES)[number];

export const MSA_KINDS = ['msa', 'framework', 'sow', 'amendment', 'addendum', 'nda', 'other'] as const;
export type MsaKind = (typeof MSA_KINDS)[number];
export const MSA_CHILD_KINDS = ['sow', 'amendment', 'addendum'] as const;

export const MSA_STATUSES = ['draft', 'in_negotiation', 'active', 'expired', 'terminated', 'pending'] as const;
export type MsaStatus = (typeof MSA_STATUSES)[number];

export interface MsaUserRef { id: string; email: string; name: string | null }
export interface MsaLiabilityCap { amountMicros: number; currency: string }

export interface MsaFileVersion {
  id: string;
  versionNo: number;
  fileName: string;
  contentType: MsaContentType;
  bytes: number;
  sha256: string;
  note: string | null;
  extractionStatus: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  createdBy: MsaUserRef | null;
  createdAt: string;
}

export interface MsaSummaryRow {
  id: string;
  companyId: string | null;
  companyName: string | null;
  parentId: string | null;
  kind: MsaKind;
  title: string;
  reference: string;
  counterparty: string | null;
  status: MsaStatus;
  effectiveDate: string | null;
  expiryDate: string | null;
  autoRenew: boolean;
  noticePeriodDays: number | null;
  /** expiryDate minus noticePeriodDays, when both are set. */
  noticeDeadline: string | null;
  daysToExpiry: number | null;
  owner: MsaUserRef | null;
  tags: string[];
  childCount: number;
  latestVersion: MsaFileVersion | null;
  updatedAt: string;
}

export interface MsaDetail extends MsaSummaryRow {
  governingLaw: string | null;
  liabilityCap: MsaLiabilityCap | null;
  paymentTerms: string | null;
  notes: string | null;
  currency: string;
  countries: string[];
  parent: { id: string; title: string; kind: MsaKind } | null;
  children: MsaSummaryRow[];
  versions: MsaFileVersion[];
  createdAt: string;
}

export interface MsaListQuery {
  companyId?: string;
  status?: MsaStatus[];
  kind?: MsaKind[];
  ownerId?: string;
  tag?: string;
  parentId?: string;
  topLevel?: 'true' | 'false';
  expiringWithinDays?: number;
  q?: string;
  sort?: 'expiry' | 'updated' | 'title';
  limit?: number;
  cursor?: number;
}

export interface MsaListResponse { items: MsaSummaryRow[]; nextCursor: number | null; total: number }

export interface MsaCreate {
  companyId: string;
  kind?: MsaKind;
  parentId?: string | null;
  title: string;
  reference?: string;
  counterparty?: string | null;
  status?: MsaStatus;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  autoRenew?: boolean;
  noticePeriodDays?: number | null;
  tags?: string[];
}

export interface MsaUploadUrlRequest { fileName: string; contentType: MsaContentType; bytes: number }
export interface MsaUploadUrlResponse { uploadUrl: string; storageKey: string; headers: Record<string, string>; maxBytes: number }
export interface MsaVersionFinalize extends MsaUploadUrlRequest { storageKey: string; note?: string | null }
export interface MsaDownloadUrlResponse { url: string; expiresAt: string; fileName: string; sha256: string }

export interface MsaTimelineEvent {
  id: string;
  at: string;
  kind: 'audit' | 'milestone';
  action: string;
  actor: MsaUserRef | null;
  detail: Record<string, unknown>;
}
export interface MsaTimelineResponse { items: MsaTimelineEvent[] }

export interface MsaDateRef { id: string; title: string; date: string; days: number }
export interface MsaAccountSummary {
  companyId: string;
  total: number;
  byStatus: Record<string, number>;
  childCounts: { sow: number; amendment: number; addendum: number };
  primary: MsaSummaryRow | null;
  nextExpiry: MsaDateRef | null;
  nextNoticeDeadline: MsaDateRef | null;
  expiringWithin90Days: number;
}

export interface MsaSearchHit {
  contractId: string;
  versionId: string;
  versionNo: number;
  title: string;
  companyId: string | null;
  kind: MsaKind;
  status: MsaStatus;
  rank: number;
  /** Matches are wrapped in [[ and ]]. */
  snippet: string;
}
export interface MsaSearchResponse { items: MsaSearchHit[] }
