// The opportunity record stores a territory name and, separately, an ISO
// country code. Demo bids such as OP-2041 (CI Financial, CA) have a country
// and no territory. The list names that country. The header must use the
// same name, or the record reads as a code.

export type OpportunityRecordPlace =
  | { kind: 'territory'; label: string }
  | { kind: 'country'; label: string }
  | { kind: 'code'; code: string }
  | { kind: 'empty' };

function recordLocale(language: string | undefined): string {
  const tag = (language ?? '').trim();
  if (!tag || tag === 'cimode') return 'en';
  return tag;
}

/**
 * English (or the active locale) name for an ISO region code.
 * Returns null when the code is not a real region, so the header does not
 * invent a country from a leftover string.
 */
function regionName(code: string, locale: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code)) return null;
  const upper = code.toUpperCase();
  try {
    const english = new Intl.DisplayNames(['en'], { type: 'region' }).of(upper);
    // ZZ is not a country. Some engines echo the code. Node 24 prints
    // "Unknown Region", which would hide a bad stored code.
    if (!english || english.toUpperCase() === upper || /unknown region/i.test(english)) {
      return null;
    }
    const name = new Intl.DisplayNames([locale || 'en'], { type: 'region' }).of(upper);
    if (!name || name.toUpperCase() === upper) return null;
    return name;
  } catch {
    return null;
  }
}

export function opportunityRecordPlace(
  input: { territoryName?: string | null; country?: string | null },
  locale: string,
): OpportunityRecordPlace {
  const territory = input.territoryName?.trim() ?? '';
  if (territory) return { kind: 'territory', label: territory };
  const country = input.country?.trim() ?? '';
  if (!country) return { kind: 'empty' };
  const name = regionName(country, recordLocale(locale));
  if (name) return { kind: 'country', label: name };
  return { kind: 'code', code: country };
}
