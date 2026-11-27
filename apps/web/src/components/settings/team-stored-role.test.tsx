import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TEAM_STORED_ROLE_CAPTION,
  TEAM_STORED_ROLE_COLUMN,
  TEAM_STORED_ROLE_HINT,
  storedRoleGrantsOrgAdmin,
  teamStoredRoleLabel,
} from './team-stored-role';

const hookMocks = vi.hoisted(() => ({
  isAdmin: true,
  useUsersPage: vi.fn(),
  useOrgPresence: vi.fn(),
  useUpdateUserRole: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, string | number>) => {
      const template = fallback ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values[name] ?? ''),
      );
    },
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => hookMocks.isAdmin,
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsersPage: hookMocks.useUsersPage,
  useOrgPresence: hookMocks.useOrgPresence,
  useUpdateUserRole: hookMocks.useUpdateUserRole,
}));

import { TeamSection } from './TeamSection';

const member = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Sam Seller',
  email: 'sam.seller@example.test',
  role: 'member',
  createdAt: '2026-01-15T12:00:00.000Z',
};

const storedAdmin = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Ada Stored',
  email: 'ada.stored@example.test',
  role: 'admin',
  createdAt: '2026-01-02T12:00:00.000Z',
};

describe('team stored role', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    hookMocks.isAdmin = true;
  });

  it('does not treat a stored admin label as an org-admin grant', () => {
    // WHY: PATCH /users/:id/role writes User.role and nothing else.
    // requireRole and useIsAdmin read the UserRole grant (settings:write).
    // A stored label of admin is still not that grant. A blank label is not
    // invented as member or admin.
    expect(storedRoleGrantsOrgAdmin('admin')).toBe(false);
    expect(storedRoleGrantsOrgAdmin('member')).toBe(false);
    expect(storedRoleGrantsOrgAdmin(null)).toBe(false);
    expect(teamStoredRoleLabel(' admin ')).toBe('admin');
    expect(teamStoredRoleLabel('member')).toBe('member');
    expect(teamStoredRoleLabel('  ')).toBe('');
    expect(teamStoredRoleLabel(null)).toBe('');
    expect(TEAM_STORED_ROLE_HINT).toMatch(/Manage roles/);
    expect(TEAM_STORED_ROLE_HINT).not.toMatch(/promote|demote/i);
    expect(TEAM_STORED_ROLE_COLUMN).toBe('Stored role');
  });

  it('does not offer promote or demote on the team list', () => {
    // WHY: Promote to admin and Demote to member only rewrite the stored
    // label. In the demo, demoting the signed-in admin flips the badge to
    // member while settings:write stays, and promoting a seller paints an
    // admin badge the admin screens still refuse. Manage roles is the
    // assignment control. The column keeps the stored word and says so.
    const sectionSrc = readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/TeamSection.tsx'),
      'utf8',
    );
    const catalog = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), 'public/locales/en/settings.json'),
        'utf8',
      ),
    ) as {
      team: {
        caption: string;
        col: { role: string; roleHint?: string };
        action?: { promote?: string; demote?: string };
      };
    };

    expect(sectionSrc).not.toContain('Promote to admin');
    expect(sectionSrc).not.toContain('Demote to member');
    expect(sectionSrc).not.toContain('useUpdateUserRole');
    expect(sectionSrc).toContain('teamStoredRoleLabel');
    expect(sectionSrc).toContain('storedRoleGrantsOrgAdmin');
    expect(catalog.team.caption).toBe(TEAM_STORED_ROLE_CAPTION);
    expect(catalog.team.col.role).toBe(TEAM_STORED_ROLE_COLUMN);
    expect(catalog.team.col.roleHint).toBe(TEAM_STORED_ROLE_HINT);
    expect(catalog.team.action?.promote).toBeUndefined();
    expect(catalog.team.action?.demote).toBeUndefined();

    hookMocks.useUsersPage.mockReturnValue({
      data: { items: [storedAdmin, member], nextCursor: null },
      isLoading: false,
      isError: false,
    });
    hookMocks.useOrgPresence.mockReturnValue({ data: new Set<string>() });
    hookMocks.useUpdateUserRole.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<TeamSection />);

    expect(screen.queryByRole('button', { name: 'Promote to admin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Demote to member' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Manage roles' })).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: /Stored role/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Manage roles/ })).toBeTruthy();
    expect(screen.getByText(TEAM_STORED_ROLE_CAPTION)).toBeTruthy();
    expect(screen.getByText('admin').className).toContain('tag-gray');
    expect(screen.getByText('admin').className).not.toContain('tag-purple');
    expect(screen.getByText('member').className).not.toContain('tag-purple');
  });
});
