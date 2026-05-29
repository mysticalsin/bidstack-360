import type { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import type { Territory } from '@bidstack/shared';

// ─── Serializer ───────────────────────────────────────────────────────────────

export function serializeTerritory(r: {
  id: string;
  orgId: string;
  name: string;
  countryCodes: string[];
  region: string | null;
  postalCodes: string[];
  ownerId: string;
  owner: { name: string | null };
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof Territory> {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    countryCodes: r.countryCodes,
    region: r.region,
    postalCodes: r.postalCodes,
    ownerId: r.ownerId,
    ownerName: r.owner.name ?? '',
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── Territory CRUD ───────────────────────────────────────────────────────────

export async function listTerritories(orgId: string) {
  const rows = await prisma.territory.findMany({
    where: { orgId, active: true },
    include: { owner: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  return rows.map(serializeTerritory);
}

export async function createTerritory(
  orgId: string,
  body: {
    name: string;
    countryCodes: string[];
    region?: string | null;
    postalCodes?: string[];
    ownerId: string;
    active?: boolean;
  },
) {
  const created = await prisma.territory.create({
    data: {
      orgId,
      name: body.name,
      countryCodes: body.countryCodes,
      region: body.region,
      postalCodes: body.postalCodes,
      ownerId: body.ownerId,
      active: body.active,
    },
    include: { owner: { select: { name: true } } },
  });
  return serializeTerritory(created);
}

export async function updateTerritory(
  orgId: string,
  id: string,
  body: {
    name?: string;
    countryCodes?: string[];
    region?: string | null;
    postalCodes?: string[];
    ownerId?: string;
    active?: boolean;
  },
) {
  const data: Prisma.TerritoryUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.countryCodes !== undefined) data.countryCodes = body.countryCodes;
  if (body.region !== undefined) data.region = body.region;
  if (body.postalCodes !== undefined) data.postalCodes = body.postalCodes;
  if (body.ownerId !== undefined) data.owner = { connect: { id: body.ownerId } };
  if (body.active !== undefined) data.active = body.active;

  const updated = await prisma.territory.update({
    where: { id, orgId },
    data,
    include: { owner: { select: { name: true } } },
  });
  return serializeTerritory(updated);
}

export async function deleteTerritory(orgId: string, id: string) {
  await prisma.territory.update({
    where: { id, orgId },
    data: { deletedAt: new Date(), active: false },
  });
  return { ok: true };
}
