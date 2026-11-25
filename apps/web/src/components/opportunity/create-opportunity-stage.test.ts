import { describe, expect, it } from 'vitest';

import { createStageGate, defaultCreateStageId } from './create-opportunity-stage';

const LEAD = '11111111-1111-4111-8111-111111111111';
const NEGOTIATION = '22222222-2222-4222-8222-222222222222';
const WON = '33333333-3333-4333-8333-333333333333';

const stages = [
  { id: LEAD, key: 's1_lead', name: 'S1 Lead', isWon: false, isLost: false },
  { id: NEGOTIATION, key: 's4_negotiation', name: 'S4 Negotiation', isWon: false, isLost: false },
  { id: WON, key: 'closed_won', name: 'Closed Won', isWon: true, isLost: false },
] as const;

describe('create opportunity stage', () => {
  it('files a new bid on the board stage the user picked, not a legacy key the create route drops', () => {
    // The create route ignores `stage` unless pipelineStageId is set, and then
    // it files the bid on the first column. A legacy key must not be treated
    // as that id.
    const dropped = createStageGate({
      isLoading: false,
      isError: false,
      stages,
      selectedId: 's4_negotiation',
    });
    expect(dropped.status).toBe('ready');
    if (dropped.status !== 'ready') return;
    expect(dropped.payload.pipelineStageId).toBe(LEAD);
    expect(dropped.payload.pipelineStageId).not.toBe('s4_negotiation');

    const picked = createStageGate({
      isLoading: false,
      isError: false,
      stages,
      selectedId: NEGOTIATION,
    });
    expect(picked).toEqual({
      status: 'ready',
      payload: { pipelineStageId: NEGOTIATION, stage: 's4_negotiation' },
      options: [
        { value: LEAD, label: 'S1 Lead' },
        { value: NEGOTIATION, label: 'S4 Negotiation' },
        { value: WON, label: 'Closed Won' },
      ],
    });
  });

  it('holds the create until the board stages have loaded, and does not offer a stage list on a failed read', () => {
    expect(
      createStageGate({ isLoading: true, isError: false, stages: [], selectedId: null }),
    ).toEqual({ status: 'loading' });
    expect(
      createStageGate({ isLoading: false, isError: true, stages: [], selectedId: null }),
    ).toEqual({ status: 'error' });
    expect(
      createStageGate({ isLoading: false, isError: false, stages: [], selectedId: null }),
    ).toEqual({ status: 'empty' });
  });

  it('keeps a loaded stage list when a later refresh fails', () => {
    const gate = createStageGate({
      isLoading: false,
      isError: true,
      stages: [stages[1]],
      selectedId: null,
    });
    expect(gate.status).toBe('ready');
    if (gate.status !== 'ready') return;
    expect(gate.payload.pipelineStageId).toBe(NEGOTIATION);
  });

  it('defaults a new bid to the first open column', () => {
    expect(defaultCreateStageId(stages)).toBe(LEAD);
    expect(
      defaultCreateStageId([
        { id: WON, key: 'closed_won', name: 'Closed Won', isWon: true, isLost: false },
        { id: LEAD, key: 's1_lead', name: 'S1 Lead', isWon: false, isLost: false },
      ]),
    ).toBe(LEAD);
    expect(
      defaultCreateStageId([
        { id: WON, key: 'closed_won', name: 'Closed Won', isWon: true, isLost: false },
      ]),
    ).toBe(WON);
  });
});
