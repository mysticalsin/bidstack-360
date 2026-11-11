import { describe, expect, it } from 'vitest';

import { isIllegalTransition } from './illegal-transition.js';
import {
  PROPOSAL_EVENTS,
  PROPOSAL_STATES,
  proposalApprovalAllowed,
  proposalFrom,
  proposalStateFromStored,
  proposalTransition,
  type ProposalEvent,
  type ProposalState,
} from './proposal.js';

const LEGAL: Array<[ProposalState, ProposalEvent, ProposalState]> = [
  ['draft', 'approve', 'approved'],
  ['review', 'approve', 'approved'],
];

describe('proposal transition table', () => {
  it('accepts every legal row and uses that from-list', () => {
    for (const [from, event, to] of LEGAL) {
      expect(proposalTransition(from, event)).toBe(to);
      expect(proposalFrom(event)).toContain(from);
    }
  });

  it('rejects the full illegal cross product', () => {
    const legal = new Set(LEGAL.map(([from, event]) => `${from}|${event}`));
    for (const from of PROPOSAL_STATES) {
      for (const event of PROPOSAL_EVENTS) {
        if (legal.has(`${from}|${event}`)) continue;
        expect(isIllegalTransition(proposalTransition(from, event))).toBe(true);
        expect(proposalFrom(event)).not.toContain(from);
      }
    }
  });

  it('allows approval only while the proposal is not deleted', () => {
    expect(proposalApprovalAllowed(null)).toBe(true);
    expect(proposalApprovalAllowed(new Date('2026-11-11T12:00:00.000Z'))).toBe(false);
  });

  it('loads a known status as itself and an unknown status as lost without calling it known', () => {
    for (const state of PROPOSAL_STATES) {
      expect(proposalStateFromStored(state)).toEqual({ state, known: true });
    }
    expect(proposalStateFromStored('mystery')).toEqual({ state: 'lost', known: false });
  });
});
