import { describe, expect, it } from 'vitest';

import {
  opportunityExportHeaders,
  opportunityExportPlaceCell,
} from './opportunity-export-place.js';

// Demo OP-2041 is CI Financial, country CA, and it has no territory. The
// opportunities list names that code Canada under a Country heading. The CSV
// still heads the column Territory and leaves the cell blank, so the download
// drops the country the list already showed.
describe('opportunity export place', () => {
  it('names a demo country and heads the column Country when no row has a territory', () => {
    expect(opportunityExportPlaceCell({ territoryName: null, country: 'CA' })).toBe('Canada');
    expect(opportunityExportPlaceCell({ territoryName: '  ', country: 'US' })).toBe(
      'United States',
    );
    const headers = opportunityExportHeaders(false);
    expect(headers[8]).toBe('Country');
    expect(headers).not.toContain('Territory');
    // The money column stays where the export tests already read it.
    expect(headers[4]).toBe('Value (EUR)');
  });

  it('keeps a territory name and the Territory heading when one row has a territory', () => {
    expect(
      opportunityExportPlaceCell({ territoryName: 'Ontario', country: 'CA' }),
    ).toBe('Ontario');
    expect(opportunityExportHeaders(true)[8]).toBe('Territory');
    // A bid on that same export still names its country when it has no territory.
    expect(opportunityExportPlaceCell({ territoryName: null, country: 'DE' })).toBe('Germany');
  });

  it('leaves a code that is not a region as written, and says when the bid has neither', () => {
    expect(opportunityExportPlaceCell({ territoryName: null, country: 'ZZ' })).toBe('ZZ');
    expect(opportunityExportPlaceCell({ territoryName: null, country: null })).toBe('No country');
  });
});
