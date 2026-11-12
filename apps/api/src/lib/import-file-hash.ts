import { createHash } from 'node:crypto';

/**
 * Identity of an uploaded CSV. Same import means the same org, the same
 * source, and this hash. Row order is part of the file. Object key order is
 * not. The user id is not part of it, so two users can import different files
 * at the same time.
 */
export function importFileHash(rows: ReadonlyArray<Readonly<Record<string, string>>>): string {
  const canonical = rows.map((row) => {
    const ordered: Record<string, string> = {};
    for (const key of Object.keys(row).sort()) ordered[key] = row[key] ?? '';
    return ordered;
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
