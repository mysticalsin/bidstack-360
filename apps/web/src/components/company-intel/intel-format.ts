const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Short UTC date, or null. */
export const fmtDate = (iso: string | null | undefined): string | null => (iso ? dateFmt.format(new Date(iso)) : null);
