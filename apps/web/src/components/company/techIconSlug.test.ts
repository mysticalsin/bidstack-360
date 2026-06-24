import { describe, expect, it } from 'vitest';

import { normalizeToSlug, techIconSlug, techLogoUrl } from './techIconSlug';

describe('techIconSlug', () => {
  // WHY: Simple Icons slugs differ from display names; a wrong slug silently
  // 404s and the user loses the real logo. These pin the catalog mismatches.
  it('maps known multi-word / renamed brands to their Simple Icons slug', () => {
    expect(techIconSlug('AWS')).toBe('amazonwebservices');
    expect(techIconSlug('Google Cloud')).toBe('googlecloud');
    expect(techIconSlug('Power BI')).toBe('powerbi');
    expect(techIconSlug('Microsoft Dynamics')).toBe('dynamics365');
    expect(techIconSlug('Oracle NetSuite')).toBe('oracle');
  });

  it('normalizes unknown names to a lowercase alnum slug', () => {
    expect(techIconSlug('Snowflake')).toBe('snowflake');
    expect(techIconSlug('Node.js')).toBe('nodejs');
    expect(normalizeToSlug('C++ Shop')).toBe('cshop');
  });

  it('returns null when no valid slug can form', () => {
    expect(techIconSlug('')).toBeNull();
    expect(techIconSlug('  ')).toBeNull();
    expect(techIconSlug('+')).toBeNull();
  });

  it('builds a same-origin proxy URL (or null)', () => {
    expect(techLogoUrl('GitHub')).toBe('/api/v1/logo?tech=github');
    expect(techLogoUrl('AWS')).toBe('/api/v1/logo?tech=amazonwebservices');
    expect(techLogoUrl('')).toBeNull();
  });
});
