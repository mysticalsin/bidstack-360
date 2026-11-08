import { describe, expect, it } from 'vitest';

import {
  DATA_REGIONS,
  DataResidencyError,
  DataSubjectRequestCreate,
  OrgDataResidency,
  resolveRegionalBucket,
} from './compliance.js';

// WHY: an org that pins its data to a region must never have its files written
// to the default bucket silently once enforcement is on. Without a regional
// bucket the write has to fail closed, not fall back.
describe('resolveRegionalBucket', () => {
  const base = { S3_BUCKET: 'polo-default', S3_REGION: 'us-east-1' };

  it('uses the default bucket when the org has no region', () => {
    expect(resolveRegionalBucket(null, base)).toEqual({
      bucket: 'polo-default',
      s3Region: 'us-east-1',
      regional: false,
    });
  });

  it('routes an EU org to the EU bucket and region when configured', () => {
    const env = { ...base, S3_BUCKET_EU: 'polo-eu', S3_REGION_EU: 'eu-west-3' };
    expect(resolveRegionalBucket('eu', env)).toEqual({
      bucket: 'polo-eu',
      s3Region: 'eu-west-3',
      regional: true,
    });
  });

  it('falls back to the default bucket in report mode when no regional bucket exists', () => {
    expect(resolveRegionalBucket('ca', base)).toEqual({
      bucket: 'polo-default',
      s3Region: 'us-east-1',
      regional: false,
    });
  });

  it('fails closed when enforcement is on and the region has no bucket', () => {
    expect(() => resolveRegionalBucket('ca', { ...base, DATA_RESIDENCY_ENFORCE: 'true' })).toThrow(
      DataResidencyError,
    );
  });

  it('enforcement does not block an org with no region', () => {
    expect(resolveRegionalBucket(null, { ...base, DATA_RESIDENCY_ENFORCE: 'true' }).bucket).toBe(
      'polo-default',
    );
  });
});

describe('compliance wire schemas', () => {
  it('lists the supported regions', () => {
    expect([...DATA_REGIONS]).toEqual(['eu', 'uk', 'us', 'ca']);
  });

  it('accepts a null region (not pinned) and rejects an unknown one', () => {
    expect(OrgDataResidency.parse({ region: null }).region).toBeNull();
    expect(() => OrgDataResidency.parse({ region: 'mars' })).toThrow();
  });

  // Erasure is irreversible: a request that omits dryRun must default to a dry run.
  it('defaults a data subject request to a dry run', () => {
    const parsed = DataSubjectRequestCreate.parse({
      kind: 'erase',
      subjectType: 'contact',
      subjectId: '11111111-1111-4111-8111-111111111111',
    });
    expect(parsed.dryRun).toBe(true);
  });
});
