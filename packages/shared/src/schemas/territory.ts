import { z } from 'zod';

export const Territory = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1),
  countryCodes: z.array(z.string()),
  region: z.string().nullable(),
  postalCodes: z.array(z.string()),
  ownerId: z.string().uuid(),
  ownerName: z.string().nullable(),
  active: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Territory = z.infer<typeof Territory>;

export const LeadRoutingRule = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1),
  active: z.boolean().default(true),
  priority: z.number().int().default(0),
  criteria: z.record(z.unknown()).default({}),
  assignToUserId: z.string().uuid().nullable(),
  assignToTerritoryId: z.string().uuid().nullable(),
  roundRobinTeam: z.array(z.string().uuid()).default([]),
  roundRobinIndex: z.number().int().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LeadRoutingRule = z.infer<typeof LeadRoutingRule>;

export const TerritoryCreate = Territory.omit({
  id: true,
  orgId: true,
  ownerName: true,
  createdAt: true,
  updatedAt: true,
});
export type TerritoryCreate = z.infer<typeof TerritoryCreate>;

export const TerritoryPatch = TerritoryCreate.partial();
export type TerritoryPatch = z.infer<typeof TerritoryPatch>;

export const LeadRoutingRuleCreate = LeadRoutingRule.omit({
  id: true,
  orgId: true,
  createdAt: true,
  updatedAt: true,
});
export type LeadRoutingRuleCreate = z.infer<typeof LeadRoutingRuleCreate>;

export const LeadRoutingRulePatch = LeadRoutingRuleCreate.partial();
export type LeadRoutingRulePatch = z.infer<typeof LeadRoutingRulePatch>;

export const Forecast = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  ownerId: z.string().uuid(),
  ownerName: z.string().nullable(),
  period: z.string().min(1),
  category: z.enum(['pipeline', 'best_case', 'commit', 'closed']),
  amountMicros: z.number().int().nonnegative(),
  currency: z.string().length(3),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Forecast = z.infer<typeof Forecast>;
