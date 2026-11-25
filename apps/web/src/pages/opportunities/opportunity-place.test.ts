// OP-2041 stores country CA and no territory. The list must say Canada.
// A territory name is the assignment, so it wins over the country code.
// An unknown code stays a code: inventing a country name would be a new lie.
import { describe, expect, it } from 'vitest';

import { opportunityPlace, opportunityPlaceColumn, regionName } from './opportunity-place';

describe('opportunity place', () => {
  it('reads demo CA as Canada, not as a territory code', () => {
    expect(regionName('CA', 'en')).toBe('Canada');
    expect(opportunityPlace({ territoryName: null, country: 'CA' }, 'en')).toEqual({
      kind: 'country',
      label: 'Canada',
    });
  });

  it('keeps a territory name when one is stored, even if the country is CA', () => {
    expect(opportunityPlace({ territoryName: 'North America', country: 'CA' }, 'en')).toEqual({
      kind: 'territory',
      label: 'North America',
    });
  });

  it('does not invent a country for a code that is not a region', () => {
    expect(regionName('XX', 'en')).toBeNull();
    expect(opportunityPlace({ territoryName: null, country: 'XX' }, 'en')).toEqual({
      kind: 'code',
      code: 'XX',
    });
  });

  it('is empty when the bid has neither a territory nor a country', () => {
    expect(opportunityPlace({ territoryName: '  ', country: null }, 'en')).toEqual({
      kind: 'empty',
    });
  });

  it('heads the column Country only when no row on the page has a territory', () => {
    expect(opportunityPlaceColumn([{ territoryName: null }, { territoryName: '' }])).toBe(
      'country',
    );
    expect(opportunityPlaceColumn([{ territoryName: 'Midwest' }])).toBe('territory');
  });
});
