/**
 * Unit tests for the Sentry PII scrubbing logic.
 *
 * WHY these tests:
 * The beforeSend hook is the last line of defense before telemetry leaves the
 * process. A regression here would cause a GDPR/CCPA privacy incident.
 */

import { describe, expect, it } from 'vitest';

import { scrubPii, scrubSentryEvent } from '../lib/sentry-privacy.js';

describe('scrubPii', () => {
  it('redacts top-level PII fields', () => {
    const input = {
      email: 'alice@example.com',
      phone: '+1234567890',
      orgId: 'org-123',
      status: 'active',
    };
    const output = scrubPii(input) as Record<string, unknown>;
    expect(output.email).toBe('[REDACTED]');
    expect(output.phone).toBe('[REDACTED]');
    expect(output.orgId).toBe('org-123');
    expect(output.status).toBe('active');
  });

  it('redacts nested PII fields', () => {
    const input = {
      opportunity: {
        id: 'opp-1',
        contact: {
          name: 'Alice Smith',
          email: 'alice@example.com',
          company: 'Acme',
        },
      },
    };
    const output = scrubPii(input) as Record<string, unknown>;
    const opportunity = output.opportunity as { contact?: Record<string, unknown> } | undefined;
    const contact = opportunity?.contact;
    expect(contact).toBeDefined();
    if (!contact) throw new Error('Expected nested contact to survive scrubbing');
    expect(contact.name).toBe('[REDACTED]');
    expect(contact.email).toBe('[REDACTED]');
    expect(contact.company).toBe('Acme');
  });

  it('redacts PII in arrays', () => {
    const input = [
      { name: 'Alice', role: 'admin' },
      { name: 'Bob', role: 'member' },
    ];
    const output = scrubPii(input) as Array<Record<string, unknown>>;
    expect(output[0]?.name).toBe('[REDACTED]');
    expect(output[1]?.name).toBe('[REDACTED]');
    expect(output[0]?.role).toBe('admin');
  });

  it('passes through non-object primitives unchanged', () => {
    expect(scrubPii(42)).toBe(42);
    expect(scrubPii('hello')).toBe('hello');
    expect(scrubPii(null)).toBe(null);
    expect(scrubPii(true)).toBe(true);
  });

  it('handles deeply nested objects without stack overflow', () => {
    let deep: Record<string, unknown> = { email: 'deep@example.com' };
    for (let i = 0; i < 12; i += 1) {
      deep = { nested: deep };
    }
    expect(() => scrubPii(deep)).not.toThrow();
  });

  it('redacts camelCase, snake_case, and worker phone-token variants', () => {
    const input = {
      phoneNumber: '555-0100',
      phone_number: '555-0101',
      firstName: 'Alice',
      first_name: 'Bob',
      apiKey: 'sk-xxx',
      api_key: 'sk-yyy',
      toNumber: '+15550100',
      from_number: '+15550101',
      authToken: 'secret-token',
      queue: 'sms.send',
    };
    const output = scrubPii(input) as Record<string, unknown>;
    for (const key of Object.keys(input).filter((key) => key !== 'queue')) {
      expect(output[key]).toBe('[REDACTED]');
    }
    expect(output.queue).toBe('sms.send');
  });

  it('does not redact non-PII fields that contain PII-like values', () => {
    const input = {
      message: 'Contact alice@example.com for details',
      description: 'Phone: +1234567890',
    };
    const output = scrubPii(input) as Record<string, unknown>;
    expect(output.message).toBe('Contact alice@example.com for details');
    expect(output.description).toBe('Phone: +1234567890');
  });

  it('scrubs request and extra payloads before Sentry sends an event', () => {
    const event = scrubSentryEvent({
      request: {
        data: {
          email: 'person@example.com',
          safe: 'kept',
        },
      },
      extra: {
        nested: {
          phone: '+15550102',
          orgId: 'org-123',
        },
      },
    });

    expect(event.request.data).toEqual({ email: '[REDACTED]', safe: 'kept' });
    expect(event.extra).toEqual({
      nested: {
        phone: '[REDACTED]',
        orgId: 'org-123',
      },
    });
  });
});
