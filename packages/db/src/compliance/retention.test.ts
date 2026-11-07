import { describe, expect, it } from 'vitest';

import { RETENTION_POLICIES, resolveRetentionConfig } from './retention.js';

// WHY: storage limitation (GDPR Art. 5(1)(e)) is a per data class decision the
// operator must be able to change without a release, and a bad value must never
// shorten retention to zero (that would mass-delete).
describe('retention policies', () => {
  it('declares one env var per data class, all RETENTION_*_DAYS and unique', () => {
    const names = RETENTION_POLICIES.map((p) => p.envVar);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^RETENTION_[A-Z_]+_DAYS$/);
  });

  it('covers the sidecar data classes that hold personal data', () => {
    expect(RETENTION_POLICIES.map((p) => p.dataClass)).toEqual(
      expect.arrayContaining([
        'email_messages',
        'sms_messages',
        'calendar_events',
        'call_transcripts',
        'meeting_transcripts',
        'meeting_ingest_payloads',
        'intel_evidence',
        'notifications',
        'voice_commands',
        'data_subject_requests',
      ]),
    );
  });

  it('defaults to report mode and the documented default periods', () => {
    const cfg = resolveRetentionConfig({});
    expect(cfg.mode).toBe('report');
    const evidence = cfg.policies.find((p) => p.dataClass === 'intel_evidence');
    expect(evidence?.days).toBe(1095);
  });

  it('applies an env override and ignores zero, negative or garbage values', () => {
    const cfg = resolveRetentionConfig({
      RETENTION_MODE: 'enforce',
      RETENTION_EMAIL_MESSAGES_DAYS: '30',
      RETENTION_SMS_MESSAGES_DAYS: '0',
      RETENTION_NOTIFICATIONS_DAYS: 'soon',
    });
    expect(cfg.mode).toBe('enforce');
    const days = Object.fromEntries(cfg.policies.map((p) => [p.dataClass, p.days]));
    const defaults = Object.fromEntries(RETENTION_POLICIES.map((p) => [p.dataClass, p.defaultDays]));
    expect(days.email_messages).toBe(30);
    expect(days.sms_messages).toBe(defaults.sms_messages);
    expect(days.notifications).toBe(defaults.notifications);
  });

  it('treats any mode other than enforce as report', () => {
    expect(resolveRetentionConfig({ RETENTION_MODE: 'yes' }).mode).toBe('report');
  });
});
