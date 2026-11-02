import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { STAGE_LIST_PAGE, stageListCaption } from './stage-list-caption';

/**
 * The stage list reads one row past the page. A caption that prints the loaded
 * length as every stage is the false read.
 */
function stageListProbes(apiSrc: string): boolean {
  const get = apiSrc.slice(
    apiSrc.indexOf("'/pipeline-stages'"),
    apiSrc.indexOf("'/pipeline-stages/:id'"),
  );
  return (
    /const STAGE_LIST_PAGE = 100/.test(get) &&
    /take:\s*STAGE_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > STAGE_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, STAGE_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    /pageContinues:\s*z\.boolean\(\)/.test(get) &&
    !/\.count\(/.test(get)
  );
}

describe('stage list caption', () => {
  it('does not call the loaded page every stage when a later row was loaded', () => {
    // WHY: GET /pipeline-stages fetched take:100 and the data-model tile
    // printed that length as "{{stages}} stages". The stage section drew the
    // same page. One more loaded row means those drawn rows are not every
    // stage. The extra row is dropped. A shorter page keeps the bare count.
    // No stage total is invented.
    const sectionSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/PipelineStagesSection.tsx'),
      'utf8',
    );
    const overviewSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/SettingsOverviewSection.tsx'),
      'utf8',
    );
    const hookSrc = readFileSync(
      path.resolve(process.cwd(), 'src/hooks/usePipelineStages.ts'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/pipeline-stages.ts'),
      'utf8',
    );
    expect(stageListProbes(apiSrc)).toBe(true);
    expect(sectionSrc).toContain('stageListCaption(stages.data.items.length, true)');
    expect(overviewSrc).toContain('stageListCaption(pipelineStages.data.items.length, true)');
    expect(hookSrc).toContain('pageContinues: boolean');
    expect(
      apiSrc.slice(apiSrc.indexOf("'/pipeline-stages'"), apiSrc.indexOf("'/pipeline-stages/:id'")),
    ).not.toMatch(/\.count\(/);

    const drawn = STAGE_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = stageListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(stageListCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every stage`,
    );

    const short = loaded.slice(0, 7);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(stageListCaption(short.length, shortContinues, short.length)).toBe(String(short.length));
    expect(stageListCaption(short.length, shortContinues, short.length)).not.toMatch(/not every/i);
  });
});
