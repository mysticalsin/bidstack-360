import { illegalTransition, type IllegalTransition } from './illegal-transition.js';

export const SMS_STATES = ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'UNDELIVERED'] as const;
export type SmsState = (typeof SMS_STATES)[number];

export const SMS_EVENTS = ['queued', 'sent', 'delivered', 'failed', 'undelivered'] as const;
export type SmsEvent = (typeof SMS_EVENTS)[number];

const EVENT_STATE: Record<SmsEvent, SmsState> = {
  queued: 'QUEUED',
  sent: 'SENT',
  delivered: 'DELIVERED',
  failed: 'FAILED',
  undelivered: 'UNDELIVERED',
};

/** Rank increases only. The three terminals share a rank, so none replaces another. */
const RANK: Record<SmsState, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  FAILED: 2,
  UNDELIVERED: 2,
};

export function smsTarget(event: SmsEvent): SmsState {
  return EVENT_STATE[event];
}

export function smsTransition(from: SmsState, event: SmsEvent): SmsState | IllegalTransition {
  const to = EVENT_STATE[event];
  if (RANK[to] <= RANK[from]) return illegalTransition();
  return to;
}

/** Statuses a callback for this event may move. Empty for `queued`: that status is only written at create. */
export function smsFrom(event: SmsEvent): readonly SmsState[] {
  return SMS_STATES.filter((from) => smsTransition(from, event) === smsTarget(event));
}

/** Twilio's status string. Unknown values are ignored and not stored. */
export function smsEventFromProvider(raw: string): SmsEvent | null {
  const key = raw.toLowerCase();
  return (SMS_EVENTS as readonly string[]).includes(key) ? (key as SmsEvent) : null;
}
