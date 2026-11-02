import { SYSTEM_ROLE_NAMES, type SystemRoleName } from '@bidstack/shared';

export interface AllowedUser {
  email: string;
  role: SystemRoleName;
  legacyRole: 'admin' | 'manager' | 'member';
}

const SYSTEM_ROLE_LOOKUP = new Map<string, SystemRoleName>(
  SYSTEM_ROLE_NAMES.map((name) => [name.toLowerCase(), name]),
);

export function legacyRoleForSystemRole(role: SystemRoleName): AllowedUser['legacyRole'] {
  if (role === 'Admin') return 'admin';
  if (role === 'Sales Manager') return 'manager';
  return 'member';
}

/**
 * Parse `POLO_ALLOWED_USERS` (`email:Role,email:Role`).
 * Role must be a seeded system role name (Admin, Sales Manager, …).
 */
export function parseAllowedUsers(raw: string | undefined): AllowedUser[] {
  const seen = new Set<string>();
  const users: AllowedUser[] = [];
  for (const part of (raw ?? '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const sep = trimmed.lastIndexOf(':');
    if (sep <= 0 || sep === trimmed.length - 1) {
      throw new Error(
        `Invalid POLO_ALLOWED_USERS entry "${trimmed}". Expected email:Role (e.g. ada@mantu.com:Admin).`,
      );
    }
    const email = trimmed.slice(0, sep).trim().toLowerCase();
    const roleRaw = trimmed.slice(sep + 1).trim();
    if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) {
      throw new Error(`Invalid POLO_ALLOWED_USERS email "${email}".`);
    }
    const role = SYSTEM_ROLE_LOOKUP.get(roleRaw.toLowerCase());
    if (!role) {
      throw new Error(
        `Invalid POLO_ALLOWED_USERS role "${roleRaw}". Use one of: ${SYSTEM_ROLE_NAMES.join(', ')}.`,
      );
    }
    if (seen.has(email)) {
      throw new Error(`Duplicate POLO_ALLOWED_USERS email "${email}".`);
    }
    seen.add(email);
    users.push({ email, role, legacyRole: legacyRoleForSystemRole(role) });
  }
  return users;
}

export function findAllowedUser(
  email: string | undefined,
  list: AllowedUser[],
): AllowedUser | undefined {
  if (!email) return undefined;
  const needle = email.trim().toLowerCase();
  return list.find((user) => user.email === needle);
}

export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
