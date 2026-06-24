import { describe, expect, it } from 'vitest';

import { normalizeToSlug, techIconSlug, techLogoUrl } from './techIconSlug';

describe('techIconSlug', () => {
  // WHY: we only emit slugs Simple Icons verifiably carries, so the proxy never
  // 404s and the <img> never breaks.
  it('returns verified slugs for brands Simple Icons carries', () => {
    expect(techIconSlug('GitHub')).toBe('github');
    expect(techIconSlug('Google Cloud')).toBe('googlecloud');
    expect(techIconSlug('Snowflake')).toBe('snowflake');
    expect(techIconSlug('Kubernetes')).toBe('kubernetes');
    expect(techIconSlug('VMware')).toBe('vmware');
  });

  // WHY: brands Simple Icons dropped (Microsoft/AWS/Salesforce/Oracle) must
  // return null → monogram, NOT a slug that would 404.
  it('returns null for brands Simple Icons does not carry', () => {
    expect(techIconSlug('AWS')).toBeNull();
    expect(techIconSlug('Microsoft 365')).toBeNull();
    expect(techIconSlug('Azure')).toBeNull();
    expect(techIconSlug('Power BI')).toBeNull();
    expect(techIconSlug('Salesforce')).toBeNull();
    expect(techIconSlug('')).toBeNull();
  });

  it('normalizes names before lookup', () => {
    expect(normalizeToSlug('Google Cloud')).toBe('googlecloud');
    expect(techIconSlug('google cloud')).toBe('googlecloud');
    expect(techIconSlug('K8s')).toBe('kubernetes');
  });

  it('builds a same-origin proxy URL only for known brands', () => {
    expect(techLogoUrl('GitHub')).toBe('/api/v1/logo?tech=github');
    expect(techLogoUrl('AWS')).toBeNull();
  });
});
