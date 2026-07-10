/**
 * Regression tests for the phone/token telemetry regexes.
 *
 * WHY these tests: PHONE_RE used to match any 9+ digit/separator run,
 * flagging dates and IPs as phone numbers; TOKEN_RE's scheme alternative
 * matched a bare scheme word plus any 8+ char English word, flagging
 * ordinary sentences ("Basic validation failed") as credentials. These
 * tests pin down the exact false positives and true positives the fix must
 * satisfy simultaneously.
 */
import { describe, expect, it } from 'vitest';

import { scrubTelemetryString } from './sentry-privacy.js';

describe('scrubTelemetryString phone matching', () => {
  it('does not flag an ISO date followed by a clock time as a phone number', () => {
    expect(scrubTelemetryString('window 2026-07-02 10:00')).toBe('window 2026-07-02 10:00');
  });

  it('does not flag a dotted-quad IP address as a phone number', () => {
    expect(scrubTelemetryString('peer 192.168.100.100 disconnected')).toBe(
      'peer 192.168.100.100 disconnected',
    );
  });

  it('still redacts a spaced international phone number', () => {
    expect(scrubTelemetryString('call +33 6 12 34 56 78 now')).toBe(
      'call [REDACTED_PHONE] now',
    );
  });

  it('still redacts a bare international phone number with no separators', () => {
    expect(scrubTelemetryString('contact +33612345678 today')).toBe(
      'contact [REDACTED_PHONE] today',
    );
  });
});

describe('scrubTelemetryString token matching', () => {
  it('does not flag a scheme word followed by an ordinary English sentence', () => {
    expect(scrubTelemetryString('Basic validation failed for row')).toBe(
      'Basic validation failed for row',
    );
  });

  it('redacts a high-entropy mixed-case Bearer token', () => {
    expect(scrubTelemetryString('Bearer eyJhbGciOiJIUzI1NiJ9.abc123')).toBe(
      'Bearer [REDACTED_TOKEN]',
    );
  });

  it('redacts a bare secret-key-shaped token with no scheme word', () => {
    expect(scrubTelemetryString('key is sk-abcdef0123456789 for prod')).toBe(
      'key is [REDACTED_TOKEN] for prod',
    );
  });

  it('still redacts explicit key=value credential assignments', () => {
    expect(scrubTelemetryString('api_key=abc123 in the request')).toBe(
      'api_key=[REDACTED_TOKEN] in the request',
    );
  });
});
