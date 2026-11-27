// The opportunities CSV used to head this column Territory and write only the
// territory name. Demo bids such as OP-2041 (CI Financial, CA) have a country
// and no territory, so the download was a blank under the wrong heading. The
// list already names that code Canada.

const REGION = /^[A-Za-z]{2}$/;

/**
 * English name for an ISO region code.
 * CSV headers are English, so the name is English too.
 * Returns null when the code is not a real region, so the export does not
 * invent a country from a leftover string.
 */
export function opportunityExportRegionName(code: string): string | null {
  if (!REGION.test(code)) return null;
  const upper = code.toUpperCase();
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(upper);
    // ZZ is not a region. DisplayNames calls it "Unknown Region". Keep the code.
    if (!name || name.toUpperCase() === upper || name.toLowerCase() === 'unknown region') return null;
    return name;
  } catch {
    return null;
  }
}

/** Territory name when the bid has one. Otherwise the country the list names. */
export function opportunityExportPlaceCell(input: {
  territoryName: string | null | undefined;
  country: string | null | undefined;
}): string {
  const territory = input.territoryName?.trim() ?? '';
  if (territory) return territory;
  const country = input.country?.trim() ?? '';
  if (!country) return 'No country';
  return opportunityExportRegionName(country) ?? country;
}

/**
 * Country when the export has no territory. One real territory keeps Territory.
 * Value stays in column 5 so existing money checks still read the same cell.
 */
export function opportunityExportHeaders(hasTerritory: boolean): readonly string[] {
  return [
    'Code',
    'Name',
    'Customer',
    'Stage',
    'Value (EUR)',
    'Probability',
    'Due date',
    'Owner',
    hasTerritory ? 'Territory' : 'Country',
    'Updated at',
  ];
}
