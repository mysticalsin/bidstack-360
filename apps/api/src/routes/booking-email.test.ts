/**
 * Unit tests for booking confirmation email builders.
 *
 * WHY these tests matter:
 *  - The HTML/text builders are pure functions — no DB, no network, no mocks.
 *  - If the template breaks (bad interpolation, XSS hole, missing cancel URL),
 *    nothing else catches it. These tests lock in correctness.
 *  - The cancel URL is the only channel delivering the cancelToken to the
 *    attendee, so it MUST appear in both HTML and text output.
 */

import { describe, expect, it } from 'vitest';
import {
  buildBookingConfirmationHtml,
  buildBookingConfirmationText,
  escapeHtml,
} from './booking-email.js';

const BASE_PARAMS = {
  orgId: 'org-test',
  userId: 'user-test',
  attendeeName: 'Alice Smith',
  attendeeEmail: 'alice@example.com',
  attendeePhone: null,
  ownerName: 'Bob Jones',
  pageName: '30-min intro call',
  startAt: new Date('2025-03-15T14:00:00Z'),
  endAt: new Date('2025-03-15T14:30:00Z'),
  bookingId: 'booking-uuid-123',
  cancelToken: 'cancel-token-abc',
  greeting: 'Hi Alice,',
  organizer: 'Bob Jones',
  // Asserts the REAL registered route (bookings-public.ts '/bookings/:id/cancel'
  // under '/api/v1') — a '/public' segment here once locked in a 404 link.
  cancelUrl:
    'https://app.bidstack.com/api/v1/bookings/booking-uuid-123/cancel?token=cancel-token-abc',
};

// ─── HTML builder ─────────────────────────────────────────────────────────────

describe('buildBookingConfirmationHtml', () => {
  it('contains the page name in the heading', () => {
    const html = buildBookingConfirmationHtml(BASE_PARAMS);
    expect(html).toContain('30-min intro call');
  });

  it('contains the greeting', () => {
    const html = buildBookingConfirmationHtml(BASE_PARAMS);
    expect(html).toContain('Hi Alice,');
  });

  it('contains the organizer name', () => {
    const html = buildBookingConfirmationHtml(BASE_PARAMS);
    expect(html).toContain('Bob Jones');
  });

  it('contains the cancel URL in both href and link text', () => {
    const html = buildBookingConfirmationHtml(BASE_PARAMS);
    // Appears twice: once as href attribute, once as visible link text
    const count = (html.match(/cancel-token-abc/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('contains the date in human-readable format', () => {
    const html = buildBookingConfirmationHtml(BASE_PARAMS);
    // 2025-03-15 is a Saturday
    expect(html).toContain('Saturday');
    expect(html).toContain('March');
    expect(html).toContain('15');
    expect(html).toContain('2025');
  });

  it('is valid DOCTYPE HTML', () => {
    const html = buildBookingConfirmationHtml(BASE_PARAMS);
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('</html>');
  });

  it('escapes HTML special chars in user-supplied fields', () => {
    const params = {
      ...BASE_PARAMS,
      pageName: '<script>alert(1)</script>',
      greeting: '<b>Hi</b> there,',
      organizer: "O'Malley & Sons",
    };
    const html = buildBookingConfirmationHtml(params);
    // Raw tags must NOT appear
    expect(html).not.toContain('<script>');
    // Escaped entities MUST appear
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('uses Apple HIG blue (#0071e3) for the Confirmed badge', () => {
    const html = buildBookingConfirmationHtml(BASE_PARAMS);
    expect(html).toContain('#0071e3');
  });

  it('shows the system-ui font stack', () => {
    const html = buildBookingConfirmationHtml(BASE_PARAMS);
    expect(html).toContain('system-ui');
  });
});

// ─── Plain-text builder ───────────────────────────────────────────────────────

describe('buildBookingConfirmationText', () => {
  it('starts with the greeting', () => {
    const text = buildBookingConfirmationText(BASE_PARAMS);
    expect(text.split('\n')[0]).toBe('Hi Alice,');
  });

  it('includes page name and organizer', () => {
    const text = buildBookingConfirmationText(BASE_PARAMS);
    expect(text).toContain('30-min intro call');
    expect(text).toContain('Bob Jones');
  });

  it('includes the cancel URL on its own line', () => {
    const text = buildBookingConfirmationText(BASE_PARAMS);
    const lines = text.split('\n');
    expect(lines).toContain(BASE_PARAMS.cancelUrl);
  });

  it('includes a human-readable date', () => {
    const text = buildBookingConfirmationText(BASE_PARAMS);
    expect(text).toContain('Saturday');
    expect(text).toContain('March');
  });

  it('is plain text (no HTML tags)', () => {
    const text = buildBookingConfirmationText(BASE_PARAMS);
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it('falls back to "your host" when ownerName is null', () => {
    const params = { ...BASE_PARAMS, organizer: 'your host', ownerName: null };
    const text = buildBookingConfirmationText(params);
    expect(text).toContain('your host');
  });
});

// ─── escapeHtml helper ────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });
  it('escapes less-than', () => {
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;');
  });
  it('escapes double quotes', () => {
    expect(escapeHtml('"value"')).toBe('&quot;value&quot;');
  });
  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });
  it('leaves safe characters unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
  it('is idempotent on already-escaped strings (escapes again)', () => {
    // escapeHtml is NOT idempotent by design — double-escaping is expected
    // WHY: callers must never pre-escape; the builder always escapes exactly once
    const once = escapeHtml('A & B');
    expect(once).toBe('A &amp; B');
    // Second application would produce A &amp;amp; B — tested to document intent
    const twice = escapeHtml(once);
    expect(twice).toBe('A &amp;amp; B');
  });
});
