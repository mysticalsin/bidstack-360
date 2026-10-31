// Plain-language labels and tones for the Agreements screens.
import type { BadgeTone } from '@/components/ui/Badge';

import type { MsaKind, MsaStatus } from './types';

export const KIND_LABEL: Record<MsaKind, string> = {
  msa: 'MSA', framework: 'Framework', sow: 'SOW', amendment: 'Amendment', addendum: 'Addendum', nda: 'NDA', other: 'Other',
};

export const STATUS_LABEL: Record<MsaStatus, string> = {
  draft: 'Draft', in_negotiation: 'In negotiation', active: 'Active', expired: 'Expired', terminated: 'Terminated', pending: 'Pending signature',
};

export const STATUS_TONE: Record<MsaStatus, BadgeTone> = {
  draft: 'gray', in_negotiation: 'amber', active: 'jade', expired: 'tomato', terminated: 'gray', pending: 'blue',
};

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function fmtDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : '–';
}

/** "in 12 days", "today", "3 days ago". */
export function fmtDays(days: number | null | undefined): string {
  if (days == null) return '';
  if (days === 0) return 'today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `${-days} day${days === -1 ? '' : 's'} ago`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtMoneyMicros(amountMicros: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(amountMicros / 1e6);
}

/** Deadline urgency for the expiring-soon strip and the list. */
export function urgency(days: number | null): 'overdue' | 'soon' | 'later' | 'none' {
  if (days == null) return 'none';
  if (days < 0) return 'overdue';
  if (days <= 30) return 'soon';
  return 'later';
}

const ACTION_LABEL: Record<string, string> = {
  'msa.create': 'Agreement created',
  'msa.update': 'Details updated',
  'msa.archive': 'Agreement archived',
  'msa.version.upload': 'New version uploaded',
  'msa.version.archive': 'Version archived',
  'msa.version.rejected': 'Upload rejected',
  'msa.download': 'File downloaded',
  'msa.view': 'Viewed',
  'msa.effective': 'Takes effect',
  'msa.notice_deadline': 'Last day to give notice',
  'msa.renewal': 'Renews automatically',
  'msa.expiry': 'Expires',
};

/** Plain-language label for a timeline/audit action. */
export function actionLabel(action: string, detail: Record<string, unknown> = {}): string {
  const base = ACTION_LABEL[action] ?? action.replace(/^msa\./, '').replace(/[._]/g, ' ');
  if (action === 'msa.version.upload' && typeof detail.versionNo === 'number') return `${base} (v${detail.versionNo})`;
  return base;
}
