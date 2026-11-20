import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FORECAST_LIST_PAGE,
  forecastGroupCaption,
  forecastTotalsNote,
} from './forecast-list-caption';

/**
 * The forecast list reads one row past the page. A caption that prints the
 * loaded groups as the whole set is the false read.
 */
function forecastListProbes(apiSrc: string): boolean {
  const route = apiSrc.slice(apiSrc.indexOf("'/forecasts'"));
  const get = route.slice(0, route.indexOf('// POST /api/forecasts'));
  return (
    /const FORECAST_LIST_PAGE = 500/.test(get) &&
    /take:\s*FORECAST_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > FORECAST_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, FORECAST_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    !/\.count\(/.test(get)
  );
}

describe('forecast group caption', () => {
  it('does not call the loaded page every forecast when a later row was loaded', () => {
    // WHY: GET /forecasts fetched take:500 and the table printed that slice
    // as "{{count}} forecast groups". The amounts above it were labeled as
    // the period totals. One more loaded row means the drawn groups are not
    // every forecast. The extra row is dropped. A shorter page keeps
    // "N forecast groups". No forecast total is invented.
    const listSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/forecasts/ForecastList.tsx'), 'utf8');
    const pageSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/ForecastsPage.tsx'), 'utf8');
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/territories-forecast.ts'),
      'utf8',
    );
    expect(forecastListProbes(apiSrc)).toBe(true);
    expect(listSrc).toContain(
      'forecastGroupCaption(rows.length, true, FORECAST_LIST_PAGE)',
    );
    expect(listSrc).not.toMatch(
      /caption=\{t\(\s*'forecastList\.sectionCaption',\s*'\{\{count\}\} forecast groups'/,
    );
    expect(pageSrc).toContain('const pageContinues = Boolean(forecasts.data?.pageContinues)');
    expect(pageSrc).toContain('forecastTotalsNote(pageContinues)');
    expect(pageSrc).not.toMatch(/\.count\(/);

    const drawn = FORECAST_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = forecastListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    const groups = Math.ceil(page.length / 4);
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(forecastGroupCaption(groups, pageContinues, drawn)).toBe(
      `${groups} forecast groups in the latest ${drawn}, not every forecast`,
    );
    expect(forecastTotalsNote(pageContinues)).toBe(
      'These amounts are the loaded forecasts for this period filter, not every forecast.',
    );

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(forecastGroupCaption(short.length, shortContinues, short.length)).toBe(
      `${short.length} forecast groups`,
    );
    expect(forecastGroupCaption(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
    expect(forecastTotalsNote(false)).toBeNull();
  });
});
