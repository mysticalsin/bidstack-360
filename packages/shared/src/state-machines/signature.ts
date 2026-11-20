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
