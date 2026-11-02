import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TERRITORY_LIST_PAGE, territoryListCaption } from './territory-list-caption';

/**
 * The territory list reads one row past the page. A caption that prints the
 * loaded length as the whole set is the false read.
 */
function territoryListProbes(apiSrc: string): boolean {
  const route = apiSrc.slice(apiSrc.indexOf("'/territories'"));
  const get = route.slice(0, route.indexOf('// POST /api/territories'));
  return (
    /const TERRITORY_LIST_PAGE = 500/.test(get) &&
    /take:\s*TERRITORY_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > TERRITORY_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, TERRITORY_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    !/\.count\(/.test(get)
  );
}

describe('territory list caption', () => {
  it('does not call the loaded page every territory when a later row was loaded', () => {
    // WHY: GET /territories fetched take:500 and the list printed that length
    // as "{{count}} total". One more loaded row means the drawn rows are not
    // every territory. The extra row is dropped. A shorter page keeps
    // "N total". No territory total is invented.
    const panelSrc = readFileSync(
      path.resolve(process.cwd(), 'src/pages/territoriesPage/TerritoryPanels.tsx'),
      'utf8',
    );
    const pageSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/TerritoriesPage.tsx'), 'utf8');
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/territories.ts'),
      'utf8',
    );
    expect(territoryListProbes(apiSrc)).toBe(true);
    expect(panelSrc).toContain('territoryListCaption(items.length, true, TERRITORY_LIST_PAGE)');
    expect(pageSrc).toContain('const pageContinues = Boolean(territories.data?.pageContinues)');
    expect(pageSrc).toContain('pageContinues={pageContinues}');
    expect(pageSrc).not.toMatch(/\.count\(/);

    const drawn = TERRITORY_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = territoryListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(territoryListCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every territory`,
    );

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(territoryListCaption(short.length, shortContinues, short.length)).toBe(
      `${short.length} total`,
    );
    expect(territoryListCaption(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
