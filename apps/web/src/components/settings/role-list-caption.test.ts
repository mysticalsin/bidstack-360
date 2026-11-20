import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROLE_LIST_PAGE, roleListCaption } from './role-list-caption';

/**
 * The role list reads one row past the page. A caption that prints the loaded
 * length as every role is the false read.
 */
function roleListProbes(apiSrc: string): boolean {
  const get = apiSrc.slice(apiSrc.indexOf("'/roles'"), apiSrc.indexOf("'/permissions'"));
  return (
    /const ROLE_LIST_PAGE = 500/.test(get) &&
    /take:\s*ROLE_LIST_PAGE\s*\+\s*1/.test(get) &&
    /const pageContinues = loaded\.length > ROLE_LIST_PAGE/.test(get) &&
    /pageContinues \? loaded\.slice\(0, ROLE_LIST_PAGE\)/.test(get) &&
    /pageContinues,/.test(get) &&
    /pageContinues:\s*z\.boolean\(\)/.test(get) &&
    !/\.count\(/.test(get)
  );
}

describe('role list caption', () => {
  it('does not call the loaded page every role when a later row was loaded', () => {
    // WHY: GET /roles fetched take:500 and the workspace tile printed that
    // length as "{{roles}} roles". The custom-role list drew the same page.
    // One more loaded row means those drawn rows are not every role. The extra
    // row is dropped. A shorter page keeps the bare count. No role total is
    // invented.
    const sectionSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/RolesSection.tsx'),
      'utf8',
    );
    const overviewSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/SettingsOverviewSection.tsx'),
      'utf8',
    );
    const hookSrc = readFileSync(path.resolve(process.cwd(), 'src/hooks/useRoles.ts'), 'utf8');
    const rolesHook = hookSrc.slice(0, hookSrc.indexOf('export function usePermissions'));
    const apiSrc = readFileSync(
      path.resolve(process.cwd(), '../../apps/api/src/routes/roles.ts'),
      'utf8',
    );
    expect(roleListProbes(apiSrc)).toBe(true);
    expect(sectionSrc).toContain('roleListCaption(allRoles.length, true)');
    expect(overviewSrc).toContain('roleListCaption(roles.data.items.length, true)');
    expect(overviewSrc).not.toContain('formatCount(roles.data?.length)');
    expect(rolesHook).toContain('pageContinues: boolean');
    expect(rolesHook).not.toMatch(/return data\.items/);
    expect(apiSrc.slice(apiSrc.indexOf("'/roles'"), apiSrc.indexOf("'/permissions'"))).not.toMatch(
      /\.count\(/,
    );

    const drawn = ROLE_LIST_PAGE;
    const loaded = Array.from({ length: drawn + 1 }, (_, n) => n);
    const pageContinues = roleListProbes(apiSrc) && loaded.length > drawn;
    const page = pageContinues ? loaded.slice(0, drawn) : loaded;
    expect(pageContinues).toBe(true);
    expect(page).toHaveLength(drawn);
    expect(roleListCaption(page.length, pageContinues, drawn)).toBe(
      `${drawn} in the latest ${drawn}, not every role`,
    );

    const short = loaded.slice(0, 3);
    const shortContinues = short.length > drawn;
    expect(shortContinues).toBe(false);
    expect(roleListCaption(short.length, shortContinues, short.length)).toBe(String(short.length));
    expect(roleListCaption(short.length, shortContinues, short.length)).not.toMatch(/not every/i);
  });
});
