import { describe, expect, it } from 'vitest';

import { isIllegalTransition } from './illegal-transition.js';
import {
  SIGNATURE_EVENTS,
  SIGNATURE_STATES,
  signatureFrom,
  signatureStateFromStored,
  signatureTransition,
  type SignatureTransitionEvent,
  type SignatureState,
} from './signature.js';

const LEGAL: Array<[SignatureState, SignatureTransitionEvent, SignatureState]> = [
  ['DRAFT', 'void', 'VOIDED'],
  ['SENT', 'void', 'VOIDED'],
  ['VIEWED', 'void', 'VOIDED'],
];

describe('signature transition table', () => {
  it('voids only from draft, sent, or viewed, and the from-list is that set', () => {
    for (const [from, event, to] of LEGAL) {
      expect(signatureTransition(from, event)).toBe(to);
      expect(signatureFrom(event)).toContain(from);
    }
    expect([...signatureFrom('void')].sort()).toEqual(['DRAFT', 'SENT', 'VIEWED']);
  });

  it('rejects the full illegal cross product', () => {
    const legal = new Set(LEGAL.map(([from, event]) => `${from}|${event}`));
    for (const from of SIGNATURE_STATES) {
      for (const event of SIGNATURE_EVENTS) {
        if (legal.has(`${from}|${event}`)) continue;
        expect(isIllegalTransition(signatureTransition(from, event))).toBe(true);
        expect(signatureFrom(event)).not.toContain(from);
      }
    }
  });

  it('loads a known status as itself and an unknown status as expired without calling it known', () => {
    for (const state of SIGNATURE_STATES) {
      expect(signatureStateFromStored(state)).toEqual({ state, known: true });
    }
    expect(signatureStateFromStored('mystery')).toEqual({ state: 'EXPIRED', known: false });
  });
});
