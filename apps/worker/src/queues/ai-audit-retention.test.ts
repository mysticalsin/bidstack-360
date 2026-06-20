import { describe, expect, it } from 'vitest';

import { resolveRetentionDays } from './ai-audit-retention.js';

describe('resolveRetentionDays', () => {
  it('falls back to 90 for missing, empty, garbage, or non-positive input', () => {
    // WHY: a bad AI_AUDIT_RETENTION_DAYS must never disable retention (0 days =
    // delete everything) or set a nonsensical window — GDPR storage-limitation.
    expect(resolveRetentionDays(undefined)).toBe(90);
    expect(resolveRetentionDays('')).toBe(90);
    expect(resolveRetentionDays('abc')).toBe(90);
    expect(resolveRetentionDays('0')).toBe(90);
    expect(resolveRetentionDays('-5')).toBe(90);
  });

  it('respects a valid positive day count', () => {
    expect(resolveRetentionDays('30')).toBe(30);
    expect(resolveRetentionDays('365')).toBe(365);
  });
});
