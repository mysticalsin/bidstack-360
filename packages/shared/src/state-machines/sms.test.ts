import { describe, expect, it } from 'vitest';

import { isIllegalTransition } from './illegal-transition.js';
import {
  SMS_EVENTS,
  SMS_STATES,
  smsEventFromProvider,
  smsFrom,
  smsStateFromStored,
  smsTarget,
  smsTransition,
  type SmsEvent,
  type SmsState,
} from './sms.js';

const LEGAL: Array<[SmsState, SmsEvent, SmsState]> = [
  ['QUEUED', 'sent', 'SENT'],
  ['QUEUED', 'delivered', 'DELIVERED'],
  ['QUEUED', 'failed', 'FAILED'],
  ['QUEUED', 'undelivered', 'UNDELIVERED'],
  ['SENT', 'delivered', 'DELIVERED'],
  ['SENT', 'failed', 'FAILED'],
  ['SENT', 'undelivered', 'UNDELIVERED'],
];

describe('sms transition table', () => {
  it('accepts every legal row and uses that from-list', () => {
    for (const [from, event, to] of LEGAL) {
      expect(smsTransition(from, event)).toBe(to);
      expect(smsTarget(event)).toBe(to);
      expect(smsFrom(event)).toContain(from);
    }
  });

  it('rejects the full illegal cross product, including a same-status callback', () => {
    const legal = new Set(LEGAL.map(([from, event]) => `${from}|${event}`));
    for (const from of SMS_STATES) {
      for (const event of SMS_EVENTS) {
        if (legal.has(`${from}|${event}`)) continue;
        expect(isIllegalTransition(smsTransition(from, event))).toBe(true);
        expect(smsFrom(event)).not.toContain(from);
      }
    }
    expect(smsFrom('queued')).toEqual([]);
  });

  it('ignores an unknown provider status and does not treat it as a stored state', () => {
    expect(smsEventFromProvider('sent')).toBe('sent');
    expect(smsEventFromProvider('DELIVERED')).toBe('delivered');
    expect(smsEventFromProvider('accepted')).toBeNull();
    expect(smsEventFromProvider('')).toBeNull();
  });

  it('loads a known status as itself and an unknown status as failed without calling it known', () => {
    for (const state of SMS_STATES) {
      expect(smsStateFromStored(state)).toEqual({ state, known: true });
    }
    expect(smsStateFromStored('mystery')).toEqual({ state: 'FAILED', known: false });
  });
});
