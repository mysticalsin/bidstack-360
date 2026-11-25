/**
 * The team table's role cell is `User.role`, a stored label (`admin` or
 * `member`). Org admin is a UserRole grant that holds `settings:write`.
 * Promoting or demoting this label does not grant or remove that role.
 */
export const TEAM_STORED_ROLE_COLUMN = 'Stored role';

export const TEAM_STORED_ROLE_HINT =
  'Stored label. Org admin is assigned with Manage roles.';

export const TEAM_STORED_ROLE_CAPTION =
  'Members of your workspace. The role column is a stored label. Org admin is assigned with Manage roles.';

export function teamStoredRoleLabel(role: string | null | undefined): string {
  return role?.trim() ?? '';
}

/**
 * No stored label is an org-admin grant. The set stays empty: `admin` on
 * this column is the same kind of text as `member`.
 */
const ORG_ADMIN_STORED_LABELS: ReadonlySet<string> = new Set();

export function storedRoleGrantsOrgAdmin(role: string | null | undefined): boolean {
  return ORG_ADMIN_STORED_LABELS.has(teamStoredRoleLabel(role));
}
