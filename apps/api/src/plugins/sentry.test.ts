/**
 * Unit tests for the Sentry PII scrubbing logic.
 *
 * WHY these tests:
 * The beforeSend hook is the last line of defense before telemetry leaves the
 * process. A regression here would cause a GDPR/CCPA privacy incident.
 */

import { describe, expect, it } from 'vitest';

import { privacyLogSerializers, scrubLogMethodArgs } from '../lib/logger.js';
import {
  scrubPii,
  scrubQueryString,
  scrubSentryEvent,
  scrubTelemetryString,
  scrubUrl,
} from '../lib/sentry-privacy.js';

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

  it('redacts PII-like values even when they appear in generic text', () => {
    const input = {
      message: 'Contact alice@example.com for details',
      description: 'Phone: +1234567890',
    };
    const output = scrubPii(input) as Record<string, unknown>;
    expect(output.message).toBe('Contact [REDACTED_EMAIL] for details');
    expect(output.description).toBe('Phone: [REDACTED_PHONE]');
  });

  it('scrubs URL and query-string PII without dropping safe parameters', () => {
    expect(
      scrubUrl('/api/search?email=alice@example.com&q=bob@example.com&limit=20&token=abc123456789'),
    ).toBe('/api/search?email=%5BREDACTED%5D&q=%5BREDACTED_EMAIL%5D&limit=20&token=%5BREDACTED%5D');
    expect(scrubQueryString('?phone=+15550123456&status=open')).toBe(
      '?phone=%5BREDACTED%5D&status=open',
    );
  });

  it('scrubs authorization tokens embedded in strings', () => {
    expect(scrubTelemetryString('Authorization: Bearer secret_token_1234567890')).toBe(
      'Authorization: Bearer [REDACTED_TOKEN]',
    );
  });

  it('scrubs request, exception, breadcrumbs, and extra payloads before Sentry sends an event', () => {
    const event = scrubSentryEvent({
      message: 'Failed for person@example.com',
      request: {
        url: '/api/contacts?email=person@example.com',
        query_string: 'phone=+15550102&status=open',
        headers: {
          authorization: 'Bearer abc123456789',
          'x-request-id': 'req-123',
        },
        cookies: 'sid=secret',
        data: {
          email: 'person@example.com',
          safe: 'kept',
        },
      },
      exception: {
        values: [
          {
            value: 'Could not sync +15550102000 for person@example.com',
          },
        ],
      },
      breadcrumbs: [
        {
          message: 'Clicked email=person@example.com',
          data: { phone: '+15550102', safe: 'kept' },
        },
      ],
      extra: {
        nested: {
          phone: '+15550102',
          orgId: 'org-123',
        },
      },
    });

    expect(event.message).toBe('Failed for [REDACTED_EMAIL]');
    expect(event.request.url).toBe('/api/contacts?email=%5BREDACTED%5D');
    expect(event.request.query_string).toBe('phone=%5BREDACTED%5D&status=open');
    expect(event.request.headers).toEqual({
      authorization: '[REDACTED]',
      'x-request-id': 'req-123',
    });
    expect(event.request.cookies).toBe('[REDACTED]');
    expect(event.request.data).toEqual({ email: '[REDACTED]', safe: 'kept' });
    expect(event.exception?.values?.[0]?.value).toBe(
      'Could not sync [REDACTED_PHONE] for [REDACTED_EMAIL]',
    );
    expect(event.breadcrumbs).toEqual([
      {
        message: 'Clicked email=[REDACTED_EMAIL]',
        data: { phone: '[REDACTED]', safe: 'kept' },
      },
    ]);
    expect(event.extra).toEqual({
      nested: {
        phone: '[REDACTED]',
        orgId: 'org-123',
      },
    });
  });

  it('scrubs Fastify/Pino request serializers before logs are emitted', () => {
    const req = privacyLogSerializers?.req?.({
      id: 'req-1',
      method: 'GET',
      url: '/api/search?email=alice@example.com&q=bob@example.com',
      headers: {
        authorization: 'Bearer abc123456789',
        'x-request-id': 'req-1',
      },
      remoteAddress: '127.0.0.1',
      remotePort: 1234,
    }) as Record<string, unknown>;

    expect(req.url).toBe('/api/search?email=%5BREDACTED%5D&q=%5BREDACTED_EMAIL%5D');
    expect(req.headers).toEqual({
      authorization: '[REDACTED]',
      'x-request-id': 'req-1',
    });

    const args = scrubLogMethodArgs([
      { email: 'alice@example.com', safe: 'kept' },
      'sync failed for +15550123456',
    ]);
    expect(args).toEqual([
      { email: '[REDACTED]', safe: 'kept' },
      'sync failed for [REDACTED_PHONE]',
    ]);
  });
});
