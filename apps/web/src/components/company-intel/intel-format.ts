import { formatPlainDateDisplay, isDateOnlyString } from '@/lib/plain-date';

const instantFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const civilDisplay = { day: 'numeric', month: 'short', year: 'numeric' } as const;

/** Calendar day for a date-only string; UTC civil day for an instant. */
export const fmtDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  if (isDateOnlyString(iso)) {
    const shown = formatPlainDateDisplay(iso, 'en-GB', civilDisplay);
    return shown === '—' ? null : shown;
  }
  return instantFmt.format(new Date(iso));
};

/** The URL when it is http or https, else undefined, so stored links can never run script. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
