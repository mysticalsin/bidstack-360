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

  // WHY: techIconSlug is icon-set ONLY — brands no icon set carries (Microsoft
  // 365, Power BI…) return null here. techLogoUrl resolves those via the curated
  // brand-domain favicon instead; only truly unknown names fall to the monogram.
  it('returns null from techIconSlug when no icon set carries the brand', () => {
    expect(techIconSlug('Microsoft 365')).toBeNull();
    expect(techIconSlug('Power BI')).toBeNull();
    expect(techIconSlug('')).toBeNull();
  });

  it('normalizes names before lookup', () => {
    expect(normalizeToSlug('Google Cloud')).toBe('googlecloud');
    expect(techIconSlug('google cloud')).toBe('googlecloud');
    expect(techIconSlug('K8s')).toBe('kubernetes');
  });

  it('builds a same-origin proxy URL: icon for icon-set brands, favicon for curated domains', () => {
    // Tier 1 — icon-set slugs.
    expect(techLogoUrl('GitHub')).toBe('/api/v1/logo?tech=github');
    expect(techLogoUrl('AWS')).toBe('/api/v1/logo?tech=amazonwebservices');
    expect(techLogoUrl('Slack')).toBe('/api/v1/logo?tech=slack');
    expect(techLogoUrl('Windows')).toBe('/api/v1/logo?tech=windows11');
    expect(techLogoUrl('Cisco Meraki')).toBe('/api/v1/logo?tech=cisco');
    expect(techLogoUrl('Palo Alto Networks')).toBe('/api/v1/logo?tech=paloaltonetworks');
    // Tier 2 — curated brand-domain favicon (no icon-set logo exists).
    expect(techLogoUrl('Microsoft 365')).toBe('/api/v1/logo?domain=microsoft.com');
    expect(techLogoUrl('CrowdStrike')).toBe('/api/v1/logo?domain=crowdstrike.com');
    expect(techLogoUrl('ServiceNow')).toBe('/api/v1/logo?domain=servicenow.com');
    expect(techLogoUrl('Workday')).toBe('/api/v1/logo?domain=workday.com');
    // Truly unknown → null → monogram.
    expect(techLogoUrl('Acme Internal Tool')).toBeNull();
  });
});
