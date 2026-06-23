import { describe, expect, it } from 'vitest';

import {
  ALLOWED_INITIATIVE_TRANSITIONS,
  INITIATIVE_STAGES,
  isAllowedInitiativeTransition,
  type InitiativeStageValue,
} from './kam-initiative.js';

describe('KAM initiative state machine', () => {
  it('allows only the locked forward edges', () => {
    expect(isAllowedInitiativeTransition('initiative', 'lead')).toBe(true);
    expect(isAllowedInitiativeTransition('initiative', 'dropped')).toBe(true);
    expect(isAllowedInitiativeTransition('lead', 'opportunity')).toBe(true);
    expect(isAllowedInitiativeTransition('lead', 'dropped')).toBe(true);
  });

  it('rejects stage-skipping (initiative cannot jump straight to opportunity)', () => {
    expect(isAllowedInitiativeTransition('initiative', 'opportunity')).toBe(false);
  });

  it('treats opportunity and dropped as terminal (no outgoing edges, no re-open)', () => {
    expect(ALLOWED_INITIATIVE_TRANSITIONS.opportunity).toEqual([]);
    expect(ALLOWED_INITIATIVE_TRANSITIONS.dropped).toEqual([]);
    for (const to of INITIATIVE_STAGES) {
      expect(isAllowedInitiativeTransition('opportunity', to)).toBe(false);
      expect(isAllowedInitiativeTransition('dropped', to)).toBe(false);
    }
  });

  it('rejects same-stage no-op transitions', () => {
    for (const stage of INITIATIVE_STAGES) {
      expect(isAllowedInitiativeTransition(stage, stage)).toBe(false);
    }
  });

  it('rejects backward transitions (lead cannot return to initiative)', () => {
    expect(isAllowedInitiativeTransition('lead', 'initiative')).toBe(false);
    expect(isAllowedInitiativeTransition('opportunity', 'lead')).toBe(false);
  });

  it('every stage has an explicit edge list (no undefined holes)', () => {
    for (const stage of INITIATIVE_STAGES as readonly InitiativeStageValue[]) {
      expect(Array.isArray(ALLOWED_INITIATIVE_TRANSITIONS[stage])).toBe(true);
    }
  });
});
