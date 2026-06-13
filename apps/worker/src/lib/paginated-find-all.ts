/**
 * Cursor-based pagination helper for worker jobs.
 *
 * Prevents OOM crashes by fetching records in fixed-size batches instead of
 * loading entire tables into memory. Uses Prisma cursor pagination (skip:1 +
 * cursor) for O(1) offset cost regardless of dataset size.
 *
 * Usage:
 *   const orgIds = await paginatedFindAll(
 *     (args) => prisma.org.findMany({ ...args, where: { deletedAt: null } }),
 *     (org) => org.id,
 *   );
 */

/** Arguments that paginatedFindAll will inject into each Prisma findMany call. */
interface PaginationArgs {
  select: { id: true };
  take: number;
  orderBy: { id: 'asc' };
  skip?: number;
  cursor?: { id: string };
}

/**
 * Fetch all records from a Prisma model in cursor-based batches.
 *
 * @param queryFn  — A function that calls prisma.model.findMany with the
 *                   provided pagination args merged into its own where/select.
 * @param getId    — Extractor for the record's `id` field.
 * @param batchSize — Number of records per batch (default: 200).
 * @returns Array of extracted values (typically IDs).
 */
export async function paginatedFindAll<T extends { id: string }>(
  queryFn: (args: PaginationArgs) => Promise<T[]>,
  getId: (item: T) => string = (item) => item.id,
  batchSize = 200,
): Promise<string[]> {
  const results: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const batch = await queryFn({
      select: { id: true },
      take: batchSize,
      orderBy: { id: 'asc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (batch.length === 0) break;
    for (const item of batch) results.push(getId(item));
    cursor = batch[batch.length - 1]!.id;
    if (batch.length < batchSize) break;
  }

  return results;
}
