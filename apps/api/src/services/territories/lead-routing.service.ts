import type { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import type { LeadRoutingRule } from '@bidstack/shared';

// ─── Serializer ───────────────────────────────────────────────────────────────

export function serializeLeadRoutingRule(r: {
  id: string;
  orgId: string;
  name: string;
  active: boolean;
  priority: number;
  criteria: Prisma.JsonValue;
  assignToUserId: string | null;
  assignToTerritoryId: string | null;
  roundRobinTeam: string[];
  roundRobinIndex: number;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof LeadRoutingRule> {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    active: r.active,
    priority: r.priority,
    criteria: r.criteria as Record<string, unknown>,
    assignToUserId: r.assignToUserId,
    assignToTerritoryId: r.assignToTerritoryId,
    roundRobinTeam: r.roundRobinTeam,
    roundRobinIndex: r.roundRobinIndex,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── Lead routing rule CRUD ───────────────────────────────────────────────────

export async function listLeadRoutingRules(orgId: string) {
  const rows = await prisma.leadRoutingRule.findMany({
    where: { orgId, active: true },
    orderBy: { priority: 'desc' },
  });
  return rows.map(serializeLeadRoutingRule);
}

export async function createLeadRoutingRule(
  orgId: string,
  body: {
    name: string;
    active?: boolean;
    priority?: number;
    criteria: Record<string, unknown>;
    assignToUserId?: string | null;
    assignToTerritoryId?: string | null;
    roundRobinTeam?: readonly string[] | null;
    roundRobinIndex?: number;
  },
) {
  const created = await prisma.leadRoutingRule.create({
    data: {
      orgId,
      name: body.name,
      active: body.active ?? true,
      priority: body.priority ?? 0,
      criteria: body.criteria as Prisma.InputJsonValue,
      assignToUserId: body.assignToUserId ?? null,
      assignToTerritoryId: body.assignToTerritoryId ?? null,
      roundRobinTeam: body.roundRobinTeam ? [...body.roundRobinTeam] : [],
      roundRobinIndex: body.roundRobinIndex ?? 0,
    },
  });
  return serializeLeadRoutingRule(created);
}

export async function updateLeadRoutingRule(
  orgId: string,
  id: string,
  body: {
    name?: string;
    active?: boolean;
    priority?: number;
    criteria?: Record<string, unknown>;
    assignToUserId?: string | null;
    assignToTerritoryId?: string | null;
    roundRobinTeam?: readonly string[];
    roundRobinIndex?: number;
  },
) {
  const data: Prisma.LeadRoutingRuleUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.active !== undefined) data.active = body.active;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.criteria !== undefined) data.criteria = body.criteria as Prisma.InputJsonValue;
  if (body.assignToUserId !== undefined) data.assignToUserId = body.assignToUserId;
  if (body.assignToTerritoryId !== undefined) data.assignToTerritoryId = body.assignToTerritoryId;
  if (body.roundRobinTeam !== undefined) data.roundRobinTeam = [...body.roundRobinTeam];
  if (body.roundRobinIndex !== undefined) data.roundRobinIndex = body.roundRobinIndex;

  const updated = await prisma.leadRoutingRule.update({
    where: { id, orgId },
    data,
  });
  return serializeLeadRoutingRule(updated);
}

export async function deleteLeadRoutingRule(orgId: string, id: string) {
  await prisma.leadRoutingRule.update({
    where: { id, orgId },
    data: { deletedAt: new Date(), active: false },
  });
  return { ok: true };
}

export async function evaluateLeadRoutingRule(
  orgId: string,
  input: {
    industry?: string;
    countryCode?: string;
    valueMicros?: number;
  },
) {
  const rules = await prisma.leadRoutingRule.findMany({
    where: { orgId, active: true },
    orderBy: { priority: 'desc' },
  });

  for (const rule of rules) {
    const criteria = rule.criteria as Record<string, unknown>;
    let match = true;
    if (criteria.industry && input.industry !== criteria.industry) match = false;
    if (criteria.countryCode && input.countryCode !== criteria.countryCode) match = false;
    if (criteria.minValue && (input.valueMicros ?? 0) < Number(criteria.minValue)) match = false;

    if (match) {
      // Round-robin: if team is defined, pick next user and advance index
      let assignToUserId = rule.assignToUserId;
      if (rule.roundRobinTeam && rule.roundRobinTeam.length > 0) {
        const team = rule.roundRobinTeam;
        const idx = rule.roundRobinIndex % team.length;
        assignToUserId = team[idx] ?? null;
        // Advance index atomically for next evaluation
        await prisma.$transaction([
          prisma.leadRoutingRule.updateMany({
            where: { id: rule.id, orgId },
            data: { roundRobinIndex: { increment: 1 } },
          }),
        ]);
      }
      return {
        matchedRuleId: rule.id,
        assignToUserId,
        assignToTerritoryId: rule.assignToTerritoryId,
      };
    }
  }

  return { matchedRuleId: null, assignToUserId: null, assignToTerritoryId: null };
}
