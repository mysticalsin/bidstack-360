// Demo backfill names the columns Lead, Ongoing, Proposal Sent, Technical
// Iteration, Negotiation, Closed Won, and Closed Lost. The badge tone map is
// keyed by the legacy enum (s3_technical_iteration, closed_won). Passing the
// column name paints every demo column gray, including a won bid and a lost bid.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { StageColumn } from './StageColumn';

function renderColumn(
  stageName: string,
  flags: { stageWon?: boolean; stageLost?: boolean } = {},
) {
  return render(
    <StageColumn
      stageId={stageName}
      stageName={stageName}
      stageColor={null}
      items={[]}
      total={0}
      conversion={null}
      isHoverTarget={false}
      draggingId={null}
      focusedId={null}
      canWrite={false}
      stageWon={flags.stageWon}
      stageLost={flags.stageLost}
      onDragOver={() => undefined}
      onDragLeave={() => undefined}
      onDrop={() => undefined}
      onCardDragStart={() => undefined}
      onCardDragEnd={() => undefined}
      onCardFocus={() => undefined}
      onCardBlur={() => undefined}
      onCardKey={() => undefined}
    />,
  );
}

function toneOf(stageName: string): string {
  return screen.getByText(stageName).className;
}

afterEach(cleanup);

describe('deal board column stage tone', () => {
  it('does not paint the demo backfill columns as one gray stage', () => {
    // WHY: a bid lead scans the board by color. Closed Won and Technical
    // Iteration are different stages. Gray on every column hides that.
    renderColumn('Lead');
    expect(toneOf('Lead')).toContain('tag-gray');
    cleanup();

    renderColumn('Ongoing');
    expect(toneOf('Ongoing')).toContain('tag-purple');
    cleanup();

    renderColumn('Proposal Sent');
    expect(toneOf('Proposal Sent')).toContain('tag-blue');
    cleanup();

    renderColumn('Technical Iteration');
    expect(toneOf('Technical Iteration')).toContain('tag-teal');
    cleanup();

    renderColumn('Negotiation');
    expect(toneOf('Negotiation')).toContain('tag-amber');
    cleanup();

    renderColumn('Closed Won');
    expect(toneOf('Closed Won')).toContain('tag-jade');
    expect(toneOf('Closed Won')).not.toContain('tag-gray');
    cleanup();

    renderColumn('Closed Lost');
    expect(toneOf('Closed Lost')).toContain('tag-tomato');
    expect(toneOf('Closed Lost')).not.toContain('tag-gray');
  });

  it('keeps the legacy enum names on the same tones', () => {
    renderColumn('S3 Technical Iteration');
    expect(toneOf('S3 Technical Iteration')).toContain('tag-teal');
    cleanup();

    renderColumn('S1 Ongoing');
    expect(toneOf('S1 Ongoing')).toContain('tag-purple');
  });

  it('paints a custom won or lost column from the stage flag, not the name', () => {
    // WHY: a stage named Won is still a win when isWon is set. The name is
    // not in the legacy map, so a name-only lookup leaves it gray.
    renderColumn('Won', { stageWon: true });
    expect(toneOf('Won')).toContain('tag-jade');
    cleanup();

    renderColumn('Lost', { stageLost: true });
    expect(toneOf('Lost')).toContain('tag-tomato');
  });

  it('does not invent a tone for a stage the board does not know', () => {
    renderColumn('Custom Review');
    expect(toneOf('Custom Review')).toContain('tag-gray');
  });
});
