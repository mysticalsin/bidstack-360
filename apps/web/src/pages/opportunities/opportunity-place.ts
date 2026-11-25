// The opportunities list stores a territory name and, separately, an ISO
// country code. Demo bids such as OP-2041 (CI Financial, CA) have a country
// and no territory. Printing the code under a Territory heading reads as a
// territory assignment the bid does not have.

export type OpportunityPlaceColumn = 'country' | 'territory';

export type OpportunityPlace =
  | { kind: 'territory'; label: string }
  | { kind: 'country'; label: string }
  | { kind: 'code'; code: string }
  | { kind: 'empty' };

export function placeLocale(language: string | undefined): string {
  const tag = (language ?? '').trim();
  if (!tag || tag === 'cimode') return 'en';
  return tag;
}

/**
 * English (or the active locale) name for an ISO region code.
 * Returns null when the code is not a real region, so the list does not
 * invent a country from a leftover string.
 */
export function regionName(code: string, locale: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code)) return null;
  const upper = code.toUpperCase();
  try {
    const name = new Intl.DisplayNames([locale || 'en'], { type: 'region' }).of(upper);
    if (!name || name.toUpperCase() === upper) return null;
    return name;
  } catch {
    return null;
  }
}

export function opportunityPlace(
  input: { territoryName: string | null; country: string | null },
  locale: string,
): OpportunityPlace {
  const territory = input.territoryName?.trim() ?? '';
  if (territory) return { kind: 'territory', label: territory };
  const country = input.country?.trim() ?? '';
  if (!country) return { kind: 'empty' };
  const name = regionName(country, locale);
  if (name) return { kind: 'country', label: name };
  return { kind: 'code', code: country };
}

/** Country when this page has no territory names. One real territory keeps the Territory heading. */
export function opportunityPlaceColumn(
  rows: Array<{ territoryName: string | null }>,
): OpportunityPlaceColumn {
  return rows.some((row) => Boolean(row.territoryName?.trim())) ? 'territory' : 'country';
}
