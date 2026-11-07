const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Short UTC date, or null. */
export const fmtDate = (iso: string | null | undefined): string | null => (iso ? dateFmt.format(new Date(iso)) : null);

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
