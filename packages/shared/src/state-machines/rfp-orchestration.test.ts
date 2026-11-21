import { describe, expect, it } from 'vitest';

import { isIllegalTransition } from './illegal-transition.js';
import {
  RFP_EVENTS,
  RFP_STATES,
  rfpFrom,
  rfpSqlIn,
  rfpTransition,
  type RfpEvent,
  type RfpState,
} from './rfp-orchestration.js';

const PHASES = [[], ['qa_review']] as const;

function withPhases(
  from: RfpState,
  event: RfpEvent,
  to: RfpState,
): Array<[RfpState, RfpEvent, readonly string[], RfpState]> {
  return PHASES.map((phases) => [from, event, phases, to]);
}

const LEGAL: Array<[RfpState, RfpEvent, readonly string[], RfpState]> = [
  ['awaiting_approval', 'resume_drafting', [], 'running'],
  ['awaiting_approval', 'approve_final', ['qa_review'], 'approved'],
  ...withPhases('queued', 'restart', 'running'),
  ...withPhases('running', 'restart', 'running'),
  ...withPhases('failed', 'restart', 'running'),
  ...withPhases('queued', 'fail', 'failed'),
  ...withPhases('running', 'fail', 'failed'),
];

describe('RFP orchestration transitions', () => {
  it('accepts the legal rows', () => {
    for (const [from, event, phases, to] of LEGAL) {
      expect(rfpTransition(from, event, phases)).toBe(to);
    }
  });

  it('rejects the rest, including a final gate resumed as drafting and an approved restart', () => {
    const legal = new Set(LEGAL.map(([from, event, phases]) => `${from}|${event}|${phases.join(',')}`));
    for (const from of RFP_STATES) {
      for (const event of RFP_EVENTS) {
        for (const phases of [[], ['qa_review']] as const) {
          const key = `${from}|${event}|${phases.join(',')}`;
          if (legal.has(key)) continue;
          expect(isIllegalTransition(rfpTransition(from, event, phases)), key).toBe(true);
        }
      }
    }
  });

  it('does not treat an unknown stored state as a safe from-state', () => {
    for (const event of RFP_EVENTS) {
      expect(isIllegalTransition(rfpTransition('not-a-state', event))).toBe(true);
    }
  });

  it('builds the compare-and-set lists from the same table', () => {
    expect(rfpFrom('resume_drafting')).toEqual(['awaiting_approval']);
    expect(rfpFrom('restart')).toEqual(['queued', 'running', 'failed']);
    expect(rfpFrom('fail')).toEqual(['queued', 'running']);
    expect(rfpSqlIn('fail')).toBe(`'queued', 'running'`);
    expect(rfpSqlIn('restart')).toBe(`'queued', 'running', 'failed'`);
  });
});
