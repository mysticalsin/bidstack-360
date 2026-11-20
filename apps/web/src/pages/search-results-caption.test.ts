import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { searchPageSlice } from '@bidstack/shared';

import { searchResultsCaption, searchResultsPage, searchTabBadge } from './search-results-caption';

/**
 * How many rows a search query returns before the extra row is dropped.
 * A slice at the limit drops the later result before the caption can tell
 * that the page is not every result.
 */
function typeQueryTake(apiSrc: string, drawn: number): number {
  const asks =
    /take:\s*perTypeLimit\s*\+\s*1/.test(apiSrc) &&
    /LIMIT \$\{perTypeLimit \+ 1\}/.test(apiSrc) &&
    /items\.length > perTypeLimit/.test(apiSrc);
  const bare = apiSrc
    .replace(/take:\s*perTypeLimit\s*\+\s*1/g, '')
    .replace(/LIMIT \$\{perTypeLimit \+ 1\}/g, '');
  const blind = /take:\s*perTypeLimit\b/.test(bare) || /LIMIT \$\{perTypeLimit\}/.test(bare);
  return asks && !blind ? drawn + 1 : drawn;
}

/** Merged page size, plus the extra ranked row when the route keeps it. */
function pageQueryTake(apiSrc: string, schemaSrc: string): number {
  const cap = Number(/const totalCap = (\d+)/.exec(apiSrc)?.[1] ?? 30);
  const asks =
    /ranked\.length > totalCap/.test(apiSrc) ||
    (/searchPageSlice\(/.test(apiSrc) && /ranked\.length > totalCap/.test(schemaSrc));
  return asks ? cap + 1 : cap;
}

describe('search results page', () => {
  it('does not call the loaded page every result when a later result was loaded', () => {
    // WHY: /search fetched a fixed page (16 per type, 30 merged) and printed
    // that length as the whole set ("16 results", "30 results"). Cutting the
    // next result left that label as if the page were every match. One more
    // loaded row means those drawn rows are not every result. The extra row
    // is dropped. A shorter list keeps "N results". No result total is invented.
    const pageSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
    const hookSrc = readFileSync(
      path.resolve(process.cwd(), 'src/hooks/useGlobalSearch.ts'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/search.ts'),
      'utf8',
    );
    const schemaSrc = readFileSync(
      path.resolve(process.cwd(), '../../packages/shared/src/schemas/search.ts'),
      'utf8',
    );
    const page = pageSrc.slice(pageSrc.indexOf('export function SearchPage'));
    const drawn = Number(/limit=(\d+)/.exec(hookSrc)?.[1] ?? 16);
    expect(page).toMatch(
      /searchResultsCaption\(\s*filtered\.length,\s*pageContinues,\s*data\?\.items\.length \?\? filtered\.length,?\s*\)/,
    );
    expect(page).toContain('Boolean(data?.pageContinues)');
    expect(page).not.toContain('search.results.countOne');
    expect(page).not.toContain('search.results.countOther');
    expect(page).not.toMatch(/\.total/);
    expect(schemaSrc).toMatch(/pageContinues:\s*z\.boolean\(\)/);
    expect(apiSrc).not.toMatch(/\.count\(/);

    const rows = Array.from({ length: drawn + 1 }, (_, n) => ({
      id: n === drawn ? 'probe-result' : `result-${n}`,
    }));
    const loaded = rows.slice(0, typeQueryTake(apiSrc, drawn));
    const drawnPage = searchResultsPage(loaded, drawn);
    const caption = searchResultsCaption(
      drawnPage.items.length,
      drawnPage.pageContinues,
      drawnPage.items.length,
    );
    expect(caption).toBe(`${drawn} in the latest ${drawn}, not every result`);
    expect(caption).not.toBe(`${drawn} results`);
    expect(caption).not.toMatch(/17/);
    expect(drawnPage.items).toHaveLength(drawn);
    expect(drawnPage.items.some((row) => row.id === 'probe-result')).toBe(false);
    expect(loaded.some((row) => row.id === 'probe-result')).toBe(true);
    expect(drawnPage.pageContinues).toBe(true);

    const cap = pageQueryTake(apiSrc, schemaSrc) - 1;
    const merged = Array.from({ length: cap + 1 }, (_, n) => ({
      id: n === cap ? 'probe-merged' : `merged-${n}`,
    }));
    const mergedLoaded = merged.slice(0, pageQueryTake(apiSrc, schemaSrc));
    const mergedPage = searchResultsPage(mergedLoaded, cap);
    const mergedCaption = searchResultsCaption(
      mergedPage.items.length,
      mergedPage.pageContinues,
      mergedPage.items.length,
    );
    expect(mergedCaption).toBe(`${cap} in the latest ${cap}, not every result`);
    expect(mergedCaption).not.toBe(`${cap} results`);
    expect(mergedCaption).not.toMatch(/\b31\b/);
    expect(mergedPage.items.some((row) => row.id === 'probe-merged')).toBe(false);
    expect(mergedLoaded.some((row) => row.id === 'probe-merged')).toBe(true);

    const shortLoaded = rows.slice(0, 5).slice(0, typeQueryTake(apiSrc, drawn));
    const short = searchResultsPage(shortLoaded, drawn);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(5);
    expect(searchResultsCaption(short.items.length, short.pageContinues, short.items.length)).toBe(
      '5 results',
    );
    expect(
      searchResultsCaption(short.items.length, short.pageContinues, short.items.length),
    ).not.toMatch(/not every/i);
    expect(searchResultsCaption(1, false, 1)).toBe('1 result');
    expect(searchResultsCaption(drawn, false, drawn)).toBe(`${drawn} results`);
    expect(searchResultsCaption(3, true, drawn)).toBe(
      `3 in the latest ${drawn}, not every result`,
    );
    expect(searchResultsCaption(3, true, drawn)).not.toBe('3 results');
  });

  it('does not call a type badge every match when that type’s extra row was cut off', () => {
    // WHY: tab badges printed how many loaded rows were of that type. Cutting
    // the next row of a type, or cutting a loaded row of that type off the
    // merged page, left the badge as if that length were every match. The
    // extra row is not a total. A shorter type keeps the number.
    const pageSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
    const hookSrc = readFileSync(
      path.resolve(process.cwd(), 'src/hooks/useGlobalSearch.ts'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/search.ts'),
      'utf8',
    );
    const schemaSrc = readFileSync(
      path.resolve(process.cwd(), '../../packages/shared/src/schemas/search.ts'),
      'utf8',
    );
    const page = pageSrc.slice(pageSrc.indexOf('export function SearchPage'));
    const drawn = Number(/limit=(\d+)/.exec(hookSrc)?.[1] ?? 16);
    expect(page).toMatch(
      /searchTabBadge\(\s*counts\[tab\.key\] \?\? 0,\s*tab\.key === 'all' \? pageContinues : continuedTypes\.has\(tab\.key\),?\s*\)/,
    );
    expect(page).toContain('new Set(data?.continuedTypes ?? [])');
    expect(page).not.toMatch(/\{counts\[tab\.key\]\}/);
    expect(hookSrc).toContain('continuedTypes?: string[]');
    expect(schemaSrc).toMatch(/continuedTypes:\s*z\.array\(SearchResultType\)/);
    expect(apiSrc).toContain('searchPageSlice(');
    expect(apiSrc).toMatch(/probedTypes\.push\(type\)/);
    expect(apiSrc).toMatch(/items\.length > perTypeLimit/);

    const opportunities = Array.from({ length: drawn + 1 }, (_, n) => ({
      type: 'opportunity' as const,
      id: n === drawn ? 'probe-opportunity' : `opp-${n}`,
    }));
    const loaded = opportunities.slice(0, typeQueryTake(apiSrc, drawn));
    const opportunityPage = searchResultsPage(loaded, drawn);
    expect(opportunityPage.pageContinues).toBe(true);
    expect(opportunityPage.items.some((row) => row.id === 'probe-opportunity')).toBe(false);
    expect(loaded.some((row) => row.id === 'probe-opportunity')).toBe(true);

    const leads = [
      { type: 'lead' as const, id: 'lead-1' },
      { type: 'lead' as const, id: 'lead-2' },
    ];
    const slice = searchPageSlice(
      [...opportunityPage.items, ...leads],
      30,
      opportunityPage.pageContinues ? ['opportunity'] : [],
    );
    const opportunityCount = slice.items.filter((row) => row.type === 'opportunity').length;
    const leadCount = slice.items.filter((row) => row.type === 'lead').length;
    const opportunityBadge = searchTabBadge(
      opportunityCount,
      slice.continuedTypes.includes('opportunity'),
    );
    const leadBadge = searchTabBadge(leadCount, slice.continuedTypes.includes('lead'));
    expect(opportunityBadge).toBe(`${drawn} in the latest ${drawn}, not every match`);
    expect(opportunityBadge).not.toBe(String(drawn));
    expect(opportunityBadge).not.toMatch(/\b17\b/);
    expect(slice.continuedTypes).not.toContain('lead');
    expect(leadBadge).toBe('2');
    expect(leadBadge).not.toMatch(/not every/i);
    const allBadge = searchTabBadge(slice.items.length, slice.pageContinues);
    expect(allBadge).toBe(
      `${slice.items.length} in the latest ${slice.items.length}, not every match`,
    );
    expect(allBadge).not.toBe(String(slice.items.length));

    const cap = Number(/const totalCap = (\d+)/.exec(apiSrc)?.[1] ?? 30);
    const typePage = Math.floor(cap / 2) + 1;
    const tasks = Array.from({ length: typePage }, (_, n) => ({
      type: 'task' as const,
      id: `task-${n}`,
    }));
    const merged = searchPageSlice(
      [
        ...Array.from({ length: typePage }, (_, n) => ({
          type: 'company' as const,
          id: `company-${n}`,
        })),
        ...tasks,
      ],
      cap,
      [],
    );
    const taskCount = merged.items.filter((row) => row.type === 'task').length;
    const companyCount = merged.items.filter((row) => row.type === 'company').length;
    const taskBadge = searchTabBadge(taskCount, merged.continuedTypes.includes('task'));
    const companyBadge = searchTabBadge(companyCount, merged.continuedTypes.includes('company'));
    expect(merged.pageContinues).toBe(true);
    expect(merged.continuedTypes).toContain('task');
    expect(merged.continuedTypes).not.toContain('company');
    expect(taskCount).toBeLessThan(tasks.length);
    expect(taskBadge).toBe(`${taskCount} in the latest ${taskCount}, not every match`);
    expect(taskBadge).not.toBe(String(tasks.length));
    expect(taskBadge).not.toBe(String(taskCount));
    expect(companyBadge).toBe(String(companyCount));
    expect(companyBadge).not.toMatch(/not every/i);

    const short = searchPageSlice(
      [
        { type: 'note', id: 'note-1' },
        { type: 'note', id: 'note-2' },
      ],
      cap,
      [],
    );
    expect(short.pageContinues).toBe(false);
    expect(short.continuedTypes).toEqual([]);
    expect(searchTabBadge(short.items.length, short.pageContinues)).toBe('2');
    expect(searchTabBadge(2, short.continuedTypes.includes('note'))).toBe('2');
    expect(searchTabBadge(1, false)).toBe('1');
  });
});
