// app_role is a cluster role. snapshotFile() dumps one database, so a restore
// onto a fresh initdb cluster does not recreate it. _prisma_migrations still
// lists the role migrations, and migrate deploy will not create it again.
// Create it before restore (so the dump's grants land) and before migrate
// (fresh install and a second boot). Least privilege, and safe to repeat.

export const ENSURE_APP_ROLE_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  ELSE
    ALTER ROLE app_role WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$$;
`;

// createdb already made schema public. pg_restore reporting that is not data loss.
const HARMLESS_RESTORE_ERROR = /schema "public" already exists/i;

function lines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function restoreErrorsThatMatter(text) {
  return lines(text).filter((line) => /^pg_restore: error:/i.test(line) && !HARMLESS_RESTORE_ERROR.test(line));
}

// Null means the restore can proceed. Any other non-zero exit, or an error
// line that is not the public-schema notice, must fail the boot.
export function restoreFailure(status, text) {
  const matter = restoreErrorsThatMatter(text);
  if (matter.length === 0 && status === 0) return null;
  const errors = lines(text).filter((line) => /^pg_restore: error:/i.test(line));
  if (matter.length === 0 && errors.length > 0 && errors.every((line) => HARMLESS_RESTORE_ERROR.test(line))) {
    return null;
  }
  const sample = (matter.length > 0 ? matter : lines(text)).slice(0, 5).join(' | ').slice(0, 500);
  return `pg_restore failed (${status ?? 'error'})${sample ? `: ${sample}` : ''}`;
}
