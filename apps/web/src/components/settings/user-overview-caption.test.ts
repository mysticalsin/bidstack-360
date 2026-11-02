import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { USER_OVERVIEW_PAGE, userOverviewCaption } from './user-overview-caption';

/**
 * GET /users already reads one row past the page and drops it. A caption that
 * prints that page length as the user count is the false read.
 */
function userRosterProbes(apiSrc: string): boolean {
  const get = apiSrc.slice(apiSrc.indexOf("'/users'"), apiSrc.indexOf("'/users/:id/role'"));
  return (
    /take:\s*limit\s*\+\s*1/.test(get) &&
    /const hasMore = rows\.length > limit/.test(get) &&
    /const page = hasMore \? rows\.slice\(0, limit\) : rows/.test(get) &&
    /nextCursor/.test(get) &&
    !/\.count\(/.test(get)
  );
}

describe('workspace user caption', () => {
  it('does not call the loaded page every user when a later row was loaded', () => {
    // WHY: the workspace tile called useUsers(), which keeps only the first
    // GET /users page (default 100) and printed that length as "{{users}}
    // users". The route already reads one more row and drops it. A nextCursor
    // means those drawn rows are not every user. A shorter page keeps the
    // bare count. No user total is invented.
    const overviewSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/SettingsOverviewSection.tsx'),
      'utf8',
    );
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/users.ts'),
      'utf8',
    );
    expect(userRosterProbes(apiSrc)).toBe(true);
    expect(overviewSrc).toContain('useUsersPage({ limit: USER_OVERVIEW_PAGE, enabled: isAdmin })');
    expect(overviewSrc).toContain('userOverviewCaption(users.data?.items.length ?? 0, true)');
    expect(overviewSrc).not.toContain('formatCount(users.data?.length)');
    expect(
      apiSrc.slice(apiSrc.indexOf("'/users'"), apiSrc.indexOf("'/users/:id/role'")),
    ).not.toMatch(/\.count\(/);

    const drawn = USER_OVERVIEW_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = userRosterProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(userOverviewCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every user`,
    );

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(userOverviewCaption(short.length, shortContinues, short.length)).toBe(
      String(short.length),
    );
    expect(userOverviewCaption(short.length, shortContinues, short.length)).not.toMatch(
      /not every/i,
    );
  });
});
