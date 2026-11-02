import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACCESS_GROUP_LIST_PAGE, accessGroupListCaption } from './access-group-list-caption';

/**
 * The access-group list reads one row past the page. A caption that prints
 * the loaded length as every group is the false read.
 */
function accessGroupListProbes(apiSrc: string, schemaSrc: string): boolean {
  const start = apiSrc.indexOf("'/user-groups'");
  const get = apiSrc.slice(start, apiSrc.indexOf("'/user-groups/:id'", start + 1));
  return (
    /const ACCESS_GROUP_LIST_PAGE = 100/.test(get) &&
    /take:\s*ACCESS_GROUP_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > ACCESS_GROUP_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, ACCESS_GROUP_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    !/\.count\(/.test(get) &&
    /pageContinues:\s*z\.boolean\(\)/.test(schemaSrc)
  );
}

describe('access group list caption', () => {
  it('does not call the loaded page every group when a later row was loaded', () => {
    // WHY: GET /user-groups fetched take:100 and the Groups heading printed
    // that length as the whole set. One more loaded row means the drawn rows
    // are not every group. The extra row is dropped. A shorter page keeps the
    // bare count. No group total is invented.
    const sectionSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/AccessGroupsSection.tsx'),
      'utf8',
    );
    const hookSrc = readFileSync(
      path.resolve(process.cwd(), 'src/hooks/useUserGroups.ts'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/user-groups.ts'),
      'utf8',
    );
    const schemaSrc = readFileSync(
      path.resolve(process.cwd(), '../../packages/shared/src/schemas/user-groups.ts'),
      'utf8',
    );
    expect(accessGroupListProbes(apiSrc, schemaSrc)).toBe(true);
    expect(hookSrc).toContain('api<UserGroupList>');
    expect(hookSrc).not.toContain('select:');
    expect(hookSrc).not.toContain('api<{ items: UserGroup[] }>');
    expect(sectionSrc).toContain('accessGroupListCaption(groups.length, true)');
    const start = apiSrc.indexOf("'/user-groups'");
    expect(apiSrc.slice(start, apiSrc.indexOf("'/user-groups/:id'", start + 1))).not.toMatch(
      /\.count\(/,
    );

    const drawn = ACCESS_GROUP_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = accessGroupListProbes(apiSrc, schemaSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(accessGroupListCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every group`,
    );

    const short = loaded.slice(0, 2);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(accessGroupListCaption(short.length, shortContinues, short.length)).toBe(
      String(short.length),
    );
    expect(accessGroupListCaption(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
