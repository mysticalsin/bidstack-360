import { describe, expect, it } from 'vitest';

import {
  dealRecordStageChoices,
  dealRecordStageMove,
  dealRecordStagePresentation,
  type DealRecordStage,
} from './deal-record-stage';

const TECHNICAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const NEGOTIATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';

const BACKFILL: DealRecordStage[] = [
  row('s1_lead', 'Lead', 0, false, false, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0'),
  row('s4_negotiation', 'Negotiation', 4, false, false, NEGOTIATION_ID),
  row('s3_technical_iteration', 'Technical Iteration', 3, false, false, TECHNICAL_ID),
  row('closed_won', 'Closed Won', 5, true, false, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5'),
];

function row(
  key: string,
  name: string,
  orderIndex: number,
  isWon: boolean,
  isLost: boolean,
  id: string,
): DealRecordStage {
  return {
    id,
    key,
    name,
    orderIndex,
    probability: 60,
    color: '#06b6d4',
    isWon,
    isLost,
  };
}

describe('deal record stage', () => {
  it('selects the pipeline stage id when the wire stage is the column name', () => {
    // WHY: demo OP-2041 serializes stage as "Technical Iteration". Binding the
    // select to that string does not match s3_technical_iteration, so the
    // control opens on S1 Lead.
    const view = dealRecordStagePresentation(
      {
        stage: 'Technical Iteration',
        pipelineStageId: TECHNICAL_ID,
        pipelineStage: {
          id: TECHNICAL_ID,
          name: 'Technical Iteration',
          isWon: false,
          isLost: false,
        },
      },
      BACKFILL,
    );

    expect(view.value).toBe(TECHNICAL_ID);
    expect(view.label).toBe('Technical Iteration');
    expect(view.toneKey).toBe('s3_technical_iteration');
  });

  it('lists board column names in column order', () => {
    expect(dealRecordStageChoices(BACKFILL).map((choice) => choice.label)).toEqual([
      'Lead',
      'Technical Iteration',
      'Negotiation',
      'Closed Won',
    ]);
  });

  it('posts the pipeline stage the board groups by', () => {
    // WHY: PATCH { stage: "s4_negotiation" } leaves pipelineStageId on the
    // open column. The card never leaves Technical Iteration.
    const move = dealRecordStageMove(BACKFILL, NEGOTIATION_ID);
    expect(move.pipelineStageId).toBe(NEGOTIATION_ID);
    expect(move.pipelineStage).toEqual({
      id: NEGOTIATION_ID,
      name: 'Negotiation',
      probability: 60,
      color: '#06b6d4',
      isWon: false,
      isLost: false,
    });
  });

  it('keeps a legacy enum when the org has no pipeline stages', () => {
    const view = dealRecordStagePresentation(
      { stage: 's2_sent', pipelineStageId: null, pipelineStage: null },
      [],
    );
    expect(view).toEqual({ value: 's2_sent', label: 'S2 Sent', toneKey: 's2_sent' });
    expect(dealRecordStageMove([], 's4_negotiation')).toEqual({
      pipelineStageId: 's4_negotiation',
    });
  });
});
