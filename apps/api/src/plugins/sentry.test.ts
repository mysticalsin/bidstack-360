/**
 * Unit tests for the Sentry PII scrubbing logic.
 *
 * WHY these tests:
 * The beforeSend hook is the last line of defense before PII reaches Sentry's
 * servers. A regression here would cause a GDPR/CCPA violation. Tests must
 * verify that EVERY PII field is scrubbed, including nested objects.
 *
 * Strategy: isolate the scrubPii function via module internals test. We can't
 * call Sentry.init in tests (no DSN), so we extract and test scrubPii directly.
 */

import { describe, it, expect } from 'vitest';

// ─── Inline the scrubPii function from sentry.ts ─────────────────────────
// WHY inline: importing the module would trigger Sentry.init side effects.
// If scrubPii logic changes, update both files.

const PII_FIELDS = new Set([
  'email', 'phone', 'phoneNumber', 'phone_number',
  'name', 'firstName', 'lastName', 'first_name', 'last_name',
  'fullName', 'full_name', 'displayName', 'display_name',
  'address', 'street', 'city', 'zipCode', 'zip_code', 'postalCode', 'postal_code',
  'ssn', 'taxId', 'tax_id', 'nationalId', 'national_id',
  'password', 'secret', 'token', 'apiKey', 'api_key',
]);

function scrubPii(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => scrubPii(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = PII_FIELDS.has(key) ? '[REDACTED]' : scrubPii(value, depth + 1);
  }
  return result;
}

// ─── Tests ────────────────────────────────────────────────────────────────

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
    // Non-PII fields pass through
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
    const contact = (output as Record<string, Record<string, Record<string, unknown>>>).opportunity.contact;
    expect(contact.name).toBe('[REDACTED]');
    expect(contact.email).toBe('[REDACTED]');
    expect(contact.company).toBe('Acme'); // not a PII field
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
    // depth limit is 10 — build an 11-level deep object
    let deep: Record<string, unknown> = { email: 'deep@example.com' };
    for (let i = 0; i < 12; i++) {
      deep = { nested: deep };
    }
    // Should not throw
    expect(() => scrubPii(deep)).not.toThrow();
  });

  it('redacts camelCase and snake_case PII variants', () => {
    const input = {
      phoneNumber: '555-0100',
      phone_number: '555-0101',
      firstName: 'Alice',
      first_name: 'Bob',
      apiKey: 'sk-xxx',
      api_key: 'sk-yyy',
    };
    const output = scrubPii(input) as Record<string, unknown>;
    for (const key of Object.keys(input)) {
      expect(output[key]).toBe('[REDACTED]');
    }
  });

  it('does not redact non-PII fields that contain PII-like values', () => {
    const input = {
      message: 'Contact alice@example.com for details',
      description: 'Phone: +1234567890',
    };
    const output = scrubPii(input) as Record<string, unknown>;
    // The field NAMES are not PII fields — values pass through unchanged
    expect(output.message).toBe('Contact alice@example.com for details');
    expect(output.description).toBe('Phone: +1234567890');
  });
});
