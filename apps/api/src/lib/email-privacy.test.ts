import { describe, expect, it } from 'vitest';

import { emailDomainForTelemetry } from './email-privacy.js';

describe('emailDomainForTelemetry', () => {
  it('keeps only the normalized domain for telemetry', () => {
    expect(emailDomainForTelemetry(' Alice.Secret@Example.COM ')).toBe('example.com');
  });

  it('returns null for missing or malformed email values', () => {
    expect(emailDomainForTelemetry(undefined)).toBeNull();
    expect(emailDomainForTelemetry('')).toBeNull();
    expect(emailDomainForTelemetry('not-an-email')).toBeNull();
    expect(emailDomainForTelemetry('@example.com')).toBeNull();
  });
});
