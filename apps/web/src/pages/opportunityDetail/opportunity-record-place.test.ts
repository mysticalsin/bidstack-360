import { describe, expect, it } from 'vitest';

import { opportunityRecordPlace } from './opportunity-record-place';

describe('opportunity record place under demo data', () => {
  it('names a demo country code instead of printing the code', () => {
    // WHY: OP-2041 is CI Financial in CA and has no territory. The list
    // already names Canada. The record header still printed CA, so the
    // same bid looked like a code on the page you open from that row.
    expect(opportunityRecordPlace({ territoryName: null, country: 'CA' }, 'en')).toEqual({
      kind: 'country',
      label: 'Canada',
    });
    expect(opportunityRecordPlace({ territoryName: null, country: 'us' }, 'en').kind).toBe(
      'country',
    );
  });

  it('keeps a territory name ahead of the country code', () => {
    // WHY: a real territory is the assignment. The country code must not
    // replace Ontario with Canada.
    expect(opportunityRecordPlace({ territoryName: 'Ontario', country: 'CA' }, 'en')).toEqual({
      kind: 'territory',
      label: 'Ontario',
    });
  });

  it('leaves a code that is not a region as the code', () => {
    // WHY: ZZ is not a country. Inventing a name would hide a bad value.
    expect(opportunityRecordPlace({ territoryName: null, country: 'ZZ' }, 'en')).toEqual({
      kind: 'code',
      code: 'ZZ',
    });
    expect(opportunityRecordPlace({ territoryName: null, country: 'Canada' }, 'en')).toEqual({
      kind: 'code',
      code: 'Canada',
    });
  });

  it('says the bid has no country when both fields are blank', () => {
    expect(opportunityRecordPlace({ territoryName: '  ', country: null }, 'en')).toEqual({
      kind: 'empty',
    });
    expect(opportunityRecordPlace({ territoryName: null, country: '  ' }, 'en')).toEqual({
      kind: 'empty',
    });
  });
});
