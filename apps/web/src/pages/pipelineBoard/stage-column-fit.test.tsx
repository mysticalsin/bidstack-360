import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MemoryRouter } from 'react-router-dom';

import type { Opportunity } from '@bidstack/shared';

import { StageColumn } from './StageColumn';

const LONG_NAME =
  'Northwind Strategic Partnership Framework Agreement for the Public Sector Cloud Program 2026';

function opportunity(id: string, name: string, customer = 'DNB Bank'): Opportunity {
  return {
    id,
    code: `OP-${id}`,
    customer,
    name,
    stage: 'S1 Lead',
    pipelineStageId: 'stage-1',
    pipelineStage: null,
    value: 1000,
    probability: 20,
    dueDate: null,
    owner: null,
    industry: null,
    logo: null,
    country: null,
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
  };
}

function renderColumn(items: Opportunity[], stageName = 'S1 Lead') {
  return render(
    <MemoryRouter>
      <StageColumn
        stageId="stage-1"
        stageName={stageName}
        stageColor={null}
        items={items}
        total={items.reduce((sum, item) => sum + item.value, 0)}
        conversion={null}
        isHoverTarget={false}
        draggingId={null}
        focusedId={null}
        canWrite={false}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onDrop={() => undefined}
        onCardDragStart={() => undefined}
        onCardDragEnd={() => undefined}
        onCardFocus={() => undefined}
        onCardBlur={() => undefined}
        onCardKey={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe('stage column fit', () => {
  afterEach(() => cleanup());

  it('keeps an empty stage as a drop target with no card', () => {
    // WHY: resizing the track must not drop an empty stage. It is still part
    // of the funnel and still accepts a card.
    renderColumn([]);
    expect(screen.getByText(/drop here/i)).toBeTruthy();
    expect(screen.queryAllByTestId('pipeline-card')).toHaveLength(0);
    expect(screen.getByTestId('pipeline-column').getAttribute('data-stage-name')).toBe('S1 Lead');
  });

  it('shows the one card in a stage', () => {
    // WHY: a stage with a single deal is the common case on the demo board
    // (S2 Sent). The card has to stay after the header layout change.
    renderColumn([opportunity('1', 'Cloud landing zone')]);
    expect(screen.getAllByTestId('pipeline-card')).toHaveLength(1);
    expect(screen.getByText('DNB Bank')).toBeTruthy();
    expect(screen.getByText('Cloud landing zone')).toBeTruthy();
  });

  it('shows every card when a stage has many', () => {
    // WHY: a busier stage (S1 Ongoing holds three on the demo board, and a
    // full page holds more) must not lose cards when the column gets wider.
    const items = Array.from({ length: 8 }, (_, index) => opportunity(String(index), `Deal ${index}`));
    renderColumn(items);
    expect(screen.getAllByTestId('pipeline-card')).toHaveLength(8);
  });

  it('truncates a long stage name inside the column and keeps the full name', () => {
    // WHY: a long stage name on one row with the count and the value wraps
    // or runs out of a 280px column. The name truncates. The full name stays
    // on the element so a clipped label is still available.
    const columnSrc = readFileSync(
      path.resolve(process.cwd(), 'src/pages/pipelineBoard/StageColumn.tsx'),
      'utf8',
    );
    expect(columnSrc).toContain('title={stageName}');
    expect(columnSrc).toContain('snap-start');

    renderColumn([opportunity('1', LONG_NAME)], LONG_NAME);
    const name = screen.getByTitle(LONG_NAME);
    expect(name.textContent).toBe(LONG_NAME);
    expect(name.className).toMatch(/truncate/);
    expect(screen.getAllByTestId('pipeline-card')).toHaveLength(1);
  });
});
