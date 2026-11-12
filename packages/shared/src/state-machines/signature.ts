import { illegalTransition, type IllegalTransition } from './illegal-transition.js';

export const SIGNATURE_STATES = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'SIGNED',
  'DECLINED',
  'VOIDED',
  'EXPIRED',
] as const;
export type SignatureState = (typeof SIGNATURE_STATES)[number];

export const SIGNATURE_EVENTS = ['void'] as const;
export type SignatureTransitionEvent = (typeof SIGNATURE_EVENTS)[number];

const FROM: Record<SignatureTransitionEvent, readonly SignatureState[]> = {
  void: ['DRAFT', 'SENT', 'VIEWED'],
};

const TO: Record<SignatureTransitionEvent, SignatureState> = {
  void: 'VOIDED',
};

/** Statuses a void compare-and-set may match. Both void checks use this list. */
export function signatureFrom(event: SignatureTransitionEvent): readonly SignatureState[] {
  return FROM[event];
}

export function signatureTransition(
  from: SignatureState,
  event: SignatureTransitionEvent,
): SignatureState | IllegalTransition {
  if (!FROM[event].includes(from)) return illegalTransition();
  return TO[event];
}

/**
 * An unknown stored value is viewed as expired and is not a known state.
 * Callers do not write that view back. Expired does not void.
 */
export function signatureStateFromStored(value: string): { state: SignatureState; known: boolean } {
  if ((SIGNATURE_STATES as readonly string[]).includes(value)) {
    return { state: value as SignatureState, known: true };
  }
  return { state: 'EXPIRED', known: false };
}
