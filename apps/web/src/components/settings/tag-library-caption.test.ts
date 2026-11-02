import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TAG_LIBRARY_PAGE, tagLibraryCaption } from './tag-library-caption';

/**
 * The tag library reads one row past the page. A caption that prints the
 * loaded length as the whole library is the false read.
 */
function tagLibraryProbes(apiSrc: string, schemaSrc: string): boolean {
  const route = apiSrc.slice(apiSrc.indexOf("'/tags'"));
  const get = route.slice(0, route.indexOf('// ─── POST /api/v1/tags'));
  return (
    /const TAG_LIBRARY_PAGE = 250/.test(get) &&
    /take:\s*TAG_LIBRARY_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > TAG_LIBRARY_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, TAG_LIBRARY_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    !/\.count\(/.test(get) &&
    /pageContinues:\s*z\.boolean\(\)/.test(schemaSrc)
  );
}

describe('tag library caption', () => {
  it('does not call the loaded page every tag when a later row was loaded', () => {
    // WHY: GET /tags fetched take:250 and the library printed that length as
    // the whole set. The settings strip printed the same length as the tag
    // count. One more loaded row means the drawn rows are not every tag. The
    // extra row is dropped. A shorter page keeps the bare count. No tag total
    // is invented.
    const sectionSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/TagsSection.tsx'),
      'utf8',
    );
    const overviewSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/SettingsOverviewSection.tsx'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/tags.ts'),
      'utf8',
    );
    const schemaSrc = readFileSync(
      path.resolve(process.cwd(), '../../packages/shared/src/schemas/tag.ts'),
      'utf8',
    );
    expect(tagLibraryProbes(apiSrc, schemaSrc)).toBe(true);
    expect(sectionSrc).toContain('tagLibraryCaption(tags.length, true)');
    expect(overviewSrc).toContain('tagLibraryCaption(tags.data.items.length, true)');
    expect(apiSrc.slice(apiSrc.indexOf("'/tags'"), apiSrc.indexOf('// ─── POST /api/v1/tags'))).not.toMatch(
      /\.count\(/,
    );

    const drawn = TAG_LIBRARY_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = tagLibraryProbes(apiSrc, schemaSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(tagLibraryCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every tag`,
    );

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(tagLibraryCaption(short.length, shortContinues, short.length)).toBe(String(short.length));
    expect(tagLibraryCaption(short.length, shortContinues, short.length)).not.toMatch(/not every/i);
  });
});
