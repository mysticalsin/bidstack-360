import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXTRACTED_REQUIREMENTS_DRAWN } from '@bidstack/shared';

import {
  extractedRequirementCaption,
  extractedRequirementPage,
  shownExtractedRequirements,
} from './requirement-caption';

/**
 * Take the extracted-requirements query actually uses. A literal page size
 * cuts the later requirement before the caption can tell that the page is
 * not the whole set.
 */
function extractedRequirementQueryTake(src: string): number {
  const start = src.indexOf('GET extracted requirements for review');
  const fn = src.slice(start, src.indexOf('GET the proposal draft'));
  if (fn.includes('take: extractedRequirementTake()')) return EXTRACTED_REQUIREMENTS_DRAWN + 1;
  const match = fn.match(/take:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function requirement(text: string) {
  return { id: text, text };
}

describe('extracted requirement page', () => {
  it('does not call the loaded page every requirement when a later requirement was loaded', () => {
    // WHY: the opportunity review list took five hundred rows and the header
    // printed that length as the extracted total. Cutting a five-hundred-first
    // requirement left "500 requirement(s) extracted" as if that page were
    // every requirement. One more loaded row means those five hundred are not
    // every requirement. The extra row is dropped. A shorter list keeps
    // "N requirement(s) extracted". No requirement total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/bid-workspace-rfp.ts'),
      'utf8',
    );
    const fn = src.slice(
      src.indexOf('GET extracted requirements for review'),
      src.indexOf('GET the proposal draft'),
    );
    expect(fn).toContain('take: extractedRequirementTake()');
    expect(fn).toContain('extractedRequirementPage(');
    expect(fn).toContain('requirementsContinue:');
    expect(fn).not.toMatch(/take:\s*500\b/);

    const panel = readFileSync(
      path.resolve(process.cwd(), 'src/components/rfp/requirements/RequirementsList.tsx'),
      'utf8',
    );
    expect(panel).toContain('extractedRequirementCaption(');
    expect(panel).not.toContain('requirements.count');
    expect(panel).not.toContain('data.total');

    const rows = Array.from({ length: EXTRACTED_REQUIREMENTS_DRAWN + 1 }, (_, n) =>
      requirement(n === EXTRACTED_REQUIREMENTS_DRAWN ? 'Probe Requirement' : `Requirement ${n}`),
    );
    const loaded = rows.slice(0, extractedRequirementQueryTake(src));
    const page = extractedRequirementPage(loaded);
    const shown = shownExtractedRequirements(page.items, page.pageContinues);
    const caption = extractedRequirementCaption(shown.items.length, shown.pageContinues);
    expect(caption).toBe('500 in the latest 500, not every requirement');
    expect(caption).not.toBe('500 requirement(s) extracted');
    expect(caption).not.toBe(`${rows.length} requirement(s) extracted`);
    expect(caption).not.toMatch(/501|Show all|View all/i);
    expect(shown.items).toHaveLength(EXTRACTED_REQUIREMENTS_DRAWN);
    expect(shown.items.some((row) => row.text === 'Probe Requirement')).toBe(false);
    expect(loaded.some((row) => row.text === 'Probe Requirement')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownExtractedRequirements(rows, false);
    expect(extractedRequirementCaption(carried.items.length, carried.pageContinues)).toBe(
      '500 in the latest 500, not every requirement',
    );
    expect(carried.items.some((row) => row.text === 'Probe Requirement')).toBe(false);

    const shortLoaded = rows.slice(0, 2).slice(0, extractedRequirementQueryTake(src));
    const shortPage = extractedRequirementPage(shortLoaded);
    const short = shownExtractedRequirements(shortPage.items, shortPage.pageContinues);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(2);
    expect(extractedRequirementCaption(short.items.length, short.pageContinues)).toBe(
      '2 requirement(s) extracted',
    );
    expect(extractedRequirementCaption(short.items.length, short.pageContinues)).not.toMatch(
      /not every/i,
    );
    expect(extractedRequirementCaption(EXTRACTED_REQUIREMENTS_DRAWN, false)).toBe(
      '500 requirement(s) extracted',
    );
  });
});
