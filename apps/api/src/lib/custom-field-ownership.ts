import { prisma } from '@bidstack/db';

/**
 * Returns the definition ids from `definitionIds` that are not active custom
 * field definitions of `orgId` for `entityType`. The value upsert keys on
 * (orgId, entityType, entityId, definitionId), so without this check a PATCH
 * could attach a value to another tenant's definition.
 *
 * @param orgId - Caller org.
 * @param entityType - Entity the values belong to (`lead`, `contact`, `company`).
 * @param definitionIds - Definition ids from the request body.
 * @returns Ids that do not belong to the caller org (empty when all are valid).
 */
export async function foreignCustomFieldDefinitions(
  orgId: string,
  entityType: string,
  definitionIds: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(definitionIds)];
  if (unique.length === 0) return [];
  const owned = await prisma.customFieldDefinition.findMany({
    where: { id: { in: unique }, orgId, entityType, active: true },
    select: { id: true },
    take: unique.length,
  });
  const ownedIds = new Set(owned.map((d) => d.id));
  return unique.filter((id) => !ownedIds.has(id));
}
