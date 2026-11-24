/** The id an operator set. An unset env must not pretend to be the vendor workspace. */
export function displayWorkspaceId(configured: string | undefined): string {
  const value = configured?.trim();
  return value ? value : 'Not configured';
}
