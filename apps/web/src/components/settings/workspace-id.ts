/**
 * Settings may print a workspace id only when the build configured one.
 * `VITE_BIDSTACK_WORKSPACE_ID` is unset in this repo. An empty value is not
 * an org, and it is not filled in with a name from another tenant.
 */
export function configuredWorkspaceId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
