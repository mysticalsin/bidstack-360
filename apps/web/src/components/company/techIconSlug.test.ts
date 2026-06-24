import { describe, expect, it } from 'vitest';

import { normalizeToSlug, techIconSlug, techLogoUrl } from './techIconSlug';

describe('techIconSlug', () => {
  // WHY: we only emit keys a source (Simple Icons or Devicon) verifiably carries,
  // so the proxy resolves a real logo and the <img> never breaks.
  it('returns verified keys for Simple Icons brands', () => {
    expect(techIconSlug('GitHub')).toBe('github');
    expect(techIconSlug('Google Cloud')).toBe('googlecloud');
    expect(techIconSlug('Snowflake')).toBe('snowflake');
    expect(techIconSlug('Kubernetes')).toBe('kubernetes');
    expect(techIconSlug('VMware')).toBe('vmware');
  });

  // WHY: enterprise brands Simple Icons dropped still resolve — via Devicon —
  // through the proxy's source chain.
  it('returns Devicon keys for the brands Simple Icons dropped', () => {
    expect(techIconSlug('AWS')).toBe('amazonwebservices');
    expect(techIconSlug('Azure')).toBe('azure');
    expect(techIconSlug('Microsoft Azure')).toBe('azure');
    expect(techIconSlug('Salesforce')).toBe('salesforce');
    expect(techIconSlug('Oracle')).toBe('oracle');
  });

  // WHY: brands no source carries (Microsoft 365, Power BI…) return null →
  // monogram, never a slug that would 404.
  it('returns null when no source carries the brand', () => {
    expect(techIconSlug('Microsoft 365')).toBeNull();
    expect(techIconSlug('Power BI')).toBeNull();
    expect(techIconSlug('')).toBeNull();
  });

  it('normalizes names before lookup', () => {
    expect(normalizeToSlug('Google Cloud')).toBe('googlecloud');
    expect(techIconSlug('google cloud')).toBe('googlecloud');
    expect(techIconSlug('K8s')).toBe('kubernetes');
  });

  it('builds a same-origin proxy URL only for known brands', () => {
    expect(techLogoUrl('GitHub')).toBe('/api/v1/logo?tech=github');
    expect(techLogoUrl('AWS')).toBe('/api/v1/logo?tech=amazonwebservices');
    expect(techLogoUrl('Microsoft 365')).toBeNull();
  });
});
