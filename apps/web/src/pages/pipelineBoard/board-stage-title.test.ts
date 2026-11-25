import { describe, expect, it } from 'vitest';

import type { PipelineStage } from '@bidstack/shared';

import {
  columnIdForStageTitle,
  omitInventedDuplicateTitles,
} from './board-stage-title';

const PROPOSAL_SENT = '33333333-3333-4333-8333-333333333333';
const TECHNICAL = '44444444-4444-4444-8444-444444444444';

function stage(id: string, name: string): PipelineStage {
  return {
    id,
    name,
    probability: 40,
    color: null,
    isWon: false,
    isLost: false,
  };
}

describe('demo stage titles on the deal board', () => {
  it('drops a second column invented from the demo title and keeps the configured one', () => {
    // WHY: Sanofi is stored as the title "Proposal Sent" with no stage row.
    // The board already has that column. Treating the title as a new stage
    // draws a second Proposal Sent column and leaves the real one empty.
    // The legacy label "S2 Sent" is a different string, so this is not the
    // enum-key match and not the closed-title match.
    const configured = [stage(PROPOSAL_SENT, 'Proposal Sent')];
    const drawn = [
      configured[0]!,
      stage('Proposal Sent', 'Proposal Sent'),
      stage('s2_sent', 'S2 Sent'),
    ];

    expect(omitInventedDuplicateTitles(drawn, configured).map((item) => item.id)).toEqual([
      PROPOSAL_SENT,
      's2_sent',
    ]);
  });

  it('keeps the legacy enum column when the demo title is a different name', () => {
    // WHY: Siemens stored as s3_technical_iteration is the enum, not the
    // title "Technical Iteration". Collapsing those two is a different fix.
    // A title column is the only one this drops.
    const configured = [stage(TECHNICAL, 'Technical Iteration')];
    const drawn = [
      configured[0]!,
      stage('s3_technical_iteration', 'S3 Technical Iteration'),
    ];

    expect(omitInventedDuplicateTitles(drawn, configured).map((item) => item.id)).toEqual([
      TECHNICAL,
      's3_technical_iteration',
    ]);
  });

  it('does not guess when two configured columns share the title', () => {
    const first = stage(PROPOSAL_SENT, 'Proposal Sent');
    const second = stage(TECHNICAL, 'Proposal Sent');
    const invented = stage('Proposal Sent', 'Proposal Sent');

    expect(omitInventedDuplicateTitles([first, second, invented], [first, second]).map((item) => item.id)).toEqual([
      PROPOSAL_SENT,
      TECHNICAL,
      'Proposal Sent',
    ]);
    expect(columnIdForStageTitle('Proposal Sent', [first, second])).toBeUndefined();
  });

  it('points a demo title at the one configured column of that name', () => {
    const column = stage(PROPOSAL_SENT, 'Proposal Sent');

    expect(columnIdForStageTitle('Proposal Sent', [column])).toBe(PROPOSAL_SENT);
    expect(columnIdForStageTitle('  proposal   sent  ', [column])).toBe(PROPOSAL_SENT);
    expect(columnIdForStageTitle('s2_sent', [column])).toBeUndefined();
    expect(columnIdForStageTitle('S2 Sent', [column])).toBeUndefined();
    expect(columnIdForStageTitle(null, [column])).toBeUndefined();
  });
});
