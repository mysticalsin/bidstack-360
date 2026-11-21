// Plain-language labels and tones for the Agreements screens.
import type { BadgeTone } from '@/components/ui/Badge';
import { formatPlainDateDisplay, isDateOnlyString } from '@/lib/plain-date';

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

const instantFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const civilDisplay = { day: 'numeric', month: 'short', year: 'numeric' } as const;
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  if (isDateOnlyString(iso)) {
    const shown = formatPlainDateDisplay(iso, 'en-GB', civilDisplay);
    return shown === '—' ? '–' : shown;
  }
  return instantFmt.format(new Date(iso));
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

function groupedUnits(micros: bigint): string {
  const units = micros / 1_000_000n;
  return units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Compact in en-GB only when two fraction digits still name this unit count. */
function compactKeepsUnits(units: number): boolean {
  const abs = Math.abs(units);
  for (const div of [1e9, 1e6, 1e3]) {
    if (abs < div) continue;
    for (let digits = 0; digits <= 2; digits += 1) {
      if (Number((abs / div).toFixed(digits)) * div === abs) return true;
    }
    return false;
  }
  return false;
}

/** Whole units plus the micros remainder. Integer division alone turns 1.50 into 1. */
function unitsFromMicros(micros: bigint): number {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / 1_000_000n;
  const remainder = abs % 1_000_000n;
  const units = Number(whole) + Number(remainder) / 1_000_000;
  return negative ? -units : units;
}

export function fmtMoneyMicros(amountMicros: number, currency: string): string {
  if (!Number.isSafeInteger(amountMicros)) return 'amount not readable';
  const micros = BigInt(amountMicros);
  if (!/^[A-Za-z]{3}$/.test(currency)) return `${groupedUnits(micros)} unspecified`;
  const units = unitsFromMicros(micros);
  const code = currency.toUpperCase();
  if (!compactKeepsUnits(units)) {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(units);
  }
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: code,
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(units);
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

/** Splits a search snippet ("a [[b]] c") into plain and matched parts; never HTML. */
export function snippetParts(snippet: string): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  const re = /\[\[(.*?)\]\]/g;
  let last = 0;
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), hit: false });
    out.push({ text: m[1] ?? '', hit: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), hit: false });
  return out;
}
