import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PIPELINE_BOARD_LIMIT,
  pipelineBoardCaption,
  pipelineColumnCaption,
} from './pipeline-board-caption';

/**
 * How many bids the board query loads before the extra row is dropped.
 * A slice at the limit drops the later bid before a column can tell that
 * the page is not every bid.
 */
function boardQueryTake(apiSrc: string, pageSrc: string): number {
  const asks =
    pageSrc.includes('limit: PIPELINE_BOARD_LIMIT') &&
    /take:\s*limit\s*\+\s*1/.test(apiSrc) &&
    /const hasMore = items\.length > limit/.test(apiSrc) &&
    /nextCursor: hasMore/.test(apiSrc);
  const bare = apiSrc.replace(/take:\s*limit\s*\+\s*1/g, '');
  const blind = /take:\s*limit\b/.test(bare);
  return asks && !blind ? PIPELINE_BOARD_LIMIT + 1 : PIPELINE_BOARD_LIMIT;
}

describe('pipeline board captions', () => {
  it('does not call the loaded cards every bid when a later bid was loaded', () => {
    // WHY: /pipeline fetched limit 50 and printed each column's loaded length
    // as that stage ("S1 column with 12 opportunities", a bare 12). Cutting
    // the next bid left those counts as if the page were the whole book. One
    // more loaded row means the drawn cards are not every bid. The extra row
    // is dropped. A shorter page keeps the card count. No bid total is invented.
    const pageSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/PipelinePage.tsx'), 'utf8');
    const columnSrc = readFileSync(
      path.resolve(process.cwd(), 'src/pages/pipelineBoard/StageColumn.tsx'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/opportunities.ts'),
      'utf8',
    );
    const page = pageSrc.slice(pageSrc.indexOf('export function PipelinePage'));
    expect(page).toContain('limit: PIPELINE_BOARD_LIMIT');
    expect(page).toContain('const pageContinues = Boolean(data?.nextCursor)');
    expect(page).toContain('const latest = data?.items.length ?? 0');
    expect(page).toContain('pageContinues={pageContinues}');
    expect(page).toContain('latest={latest}');
    expect(page).toMatch(/pipelineBoardCaption\(\s*count,\s*pageContinues,\s*latest\s*\)/);
    expect(columnSrc).toContain('pipelineColumnCaption(items.length, pageContinues, latest)');
    expect(columnSrc).not.toMatch(/column with \$\{items\.length\} opportunities/);

    const drawn = PIPELINE_BOARD_LIMIT;
    const take = boardQueryTake(apiSrc, page);
    const loaded = Array.from({ length: take }, (_, i) => i);
    const pageContinues = loaded.length > drawn;
    const cards = pageContinues ? loaded.slice(0, drawn) : loaded;
    const inStage = cards.filter((n) => n % 5 === 0);
    expect(pageContinues).toBe(true);
    expect(cards).toHaveLength(drawn);
    expect(pipelineColumnCaption(inStage.length, pageContinues, cards.length)).toBe(
      `${inStage.length} in the latest ${drawn}, not every bid`,
    );
    expect(pipelineBoardCaption(cards.length, pageContinues, cards.length)).toBe(
      `${drawn} in the latest ${drawn}, not every bid`,
    );
    expect(pipelineColumnCaption(0, pageContinues, cards.length)).toBe(
      `0 in the latest ${drawn}, not every bid`,
    );

    const shortLoaded = loaded.slice(0, 3).slice(0, take);
    const shortContinues = shortLoaded.length > drawn;
    expect(shortContinues).toBe(false);
    expect(pipelineColumnCaption(shortLoaded.length, shortContinues, shortLoaded.length)).toBe(
      String(shortLoaded.length),
    );
    expect(pipelineBoardCaption(1, false, 1)).toBe('1 opportunity');
    expect(pipelineBoardCaption(shortLoaded.length, shortContinues, shortLoaded.length)).toBe(
      `${shortLoaded.length} opportunities`,
    );
    expect(pipelineBoardCaption(shortLoaded.length, shortContinues, shortLoaded.length)).not.toMatch(
      /not every/i,
    );
  });
});
