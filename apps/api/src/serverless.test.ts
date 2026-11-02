import { describe, expect, it } from 'vitest';

import { rewriteServerlessUrl, tuneDatabaseUrl } from './serverless.js';

describe('tuneDatabaseUrl', () => {
  it('adds pgbouncer and pool limits for a Neon pooled host', () => {
    const out = new URL(
      tuneDatabaseUrl(
        'postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db?sslmode=require',
      )!,
    );
    expect(out.searchParams.get('pgbouncer')).toBe('true');
    expect(out.searchParams.get('connection_limit')).toBe('5');
    expect(out.searchParams.get('pool_timeout')).toBe('20');
    expect(out.searchParams.get('sslmode')).toBe('require');
  });

  it('leaves pgbouncer off for a direct host and keeps explicit values', () => {
    const out = new URL(tuneDatabaseUrl('postgresql://u:p@ep-x.neon.tech/db?connection_limit=2')!);
    expect(out.searchParams.has('pgbouncer')).toBe(false);
    expect(out.searchParams.get('connection_limit')).toBe('2');
  });

  it('passes through empty or unparsable values', () => {
    expect(tuneDatabaseUrl(undefined)).toBeUndefined();
    expect(tuneDatabaseUrl('not a url')).toBe('not a url');
  });
});

describe('rewriteServerlessUrl', () => {
  it('maps /api probes to the root probes', () => {
    expect(rewriteServerlessUrl('/api/health')).toBe('/health');
    expect(rewriteServerlessUrl('/api/readyz?x=1')).toBe('/readyz?x=1');
    expect(rewriteServerlessUrl('/api/livez')).toBe('/livez');
  });

  it('leaves every other path alone', () => {
    expect(rewriteServerlessUrl('/api/healthcheck')).toBe('/api/healthcheck');
    expect(rewriteServerlessUrl('/api/v1/companies')).toBe('/api/v1/companies');
    expect(rewriteServerlessUrl(undefined)).toBe('/');
  });
});
