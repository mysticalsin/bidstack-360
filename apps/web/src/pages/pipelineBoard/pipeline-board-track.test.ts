import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PIPELINE_COLUMN_GAP_PX,
  PIPELINE_COLUMN_MIN_PX,
  pipelineColumnWidth,
} from './pipeline-board-track';

const pageSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/PipelinePage.tsx'), 'utf8');
const page = pageSrc.slice(pageSrc.indexOf('export function PipelinePage'));

function wholeColumns(boardWidth: number): { count: number; width: number } {
  const width = pipelineColumnWidth(boardWidth);
  const gap = PIPELINE_COLUMN_GAP_PX;
  const count = Math.max(1, Math.round((boardWidth + gap) / (width + gap)));
  return { count, width };
}

describe('pipeline column track', () => {
  it('fills the 1280px board with whole columns and the page uses that width', () => {
    // WHY: at a 1280 viewport the board client width is 992px (232px sidebar,
    // 28px of page padding on each side). Columns of 280px start a fourth
    // stage inside the viewport and run it past the edge, so that stage's
    // value is off-screen. The S3 header content measured 279px and wrapped
    // inside a 280px column. The track has to fill 992px with whole columns
    // wider than that header, and the page has to apply the width.
    const board = 992;
    const { count, width } = wholeColumns(board);
    const gap = PIPELINE_COLUMN_GAP_PX;
    expect(count).toBe(3);
    expect(width).toBeGreaterThan(279);
    expect(width).toBeGreaterThanOrEqual(PIPELINE_COLUMN_MIN_PX);
    expect(count * width + (count - 1) * gap).toBeCloseTo(board, 5);

    expect(page).toContain('pipelineColumnWidth(');
    expect(page).toContain('gridAutoColumns');
    expect(page).toContain('snap-x');
    expect(page).toContain('snap-mandatory');
  });

  it('uses one column when two minimum columns do not fit, including an empty width', () => {
    // WHY: a board narrower than 280 + gap + 280 must not invent a second
    // sliver. An unmeasured board (0) still has a column size.
    expect(pipelineColumnWidth(280)).toBe(280);
    expect(pipelineColumnWidth(571)).toBe(571);
    expect(pipelineColumnWidth(0)).toBe(PIPELINE_COLUMN_MIN_PX);
    expect(pipelineColumnWidth(Number.NaN)).toBe(PIPELINE_COLUMN_MIN_PX);
  });

  it('keeps a whole number of columns when the board is wide', () => {
    // WHY: a wide window still must not leave a partial stage at the edge.
    const board = 1600;
    const { count, width } = wholeColumns(board);
    const gap = PIPELINE_COLUMN_GAP_PX;
    expect(count).toBeGreaterThan(3);
    expect(width).toBeGreaterThanOrEqual(PIPELINE_COLUMN_MIN_PX);
    expect(count * width + (count - 1) * gap).toBeCloseTo(board, 5);
    const oneMore = count + 1;
    expect(oneMore * PIPELINE_COLUMN_MIN_PX + (oneMore - 1) * gap).toBeGreaterThan(board);
  });
});
