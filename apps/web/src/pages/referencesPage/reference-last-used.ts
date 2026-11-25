// The reference library's "Last used" cell used to call toLocaleDateString()
// and return null when the timestamp was missing. On the seeded library that
// hides the comparison the column is for: CI Financial was used 12 days ago,
// Rush 30 days ago, and DNB Bank has never been used. A null cell becomes the
// table's em dash, the same mark as a missing document.

import { formatDate } from '@/lib/format';

const DAY_MS = 86_400_000;
// Rush is seeded at 30 days. Inside this window the cell says "N days ago".
// Older than that, the seed is no longer a recency, so the cell shows the date.
const RECENT_DAYS = 30;

export type ReferenceLastUsed =
  { kind: 'never' } | { kind: 'unknown' } | { kind: 'shown'; text: string; title: string };

// Same detector as format.ts. The column used to ignore bidstack-locale.
function appLocale(): string {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem('bidstack-locale');
    if (stored) return stored;
  } catch {
    /* storage may be blocked */
  }
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en';
}

/**
 * How the library says when a case study was last used.
 * `never` is a missing timestamp (the seeded DNB row). `unknown` is a value
 * that is not a date — that stays empty rather than reading as "Never".
 * A use in the last 30 days is a recency; the absolute date is the title.
 * A future timestamp stays an absolute date.
 */
export function describeReferenceLastUsed(
  lastUsedAt: string | null,
  nowMs: number = Date.now(),
  locale: string = appLocale(),
): ReferenceLastUsed {
  if (!lastUsedAt) return { kind: 'never' };
  const ms = Date.parse(lastUsedAt);
  if (Number.isNaN(ms)) return { kind: 'unknown' };
  const absolute = formatDate(lastUsedAt, locale);
  const days = Math.floor((nowMs - ms) / DAY_MS);
  if (days >= 0 && days <= RECENT_DAYS) {
    const text = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-days, 'day');
    return { kind: 'shown', text, title: absolute };
  }
  return { kind: 'shown', text: absolute, title: absolute };
}
