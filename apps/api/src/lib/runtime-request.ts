/**
 * Per-request half of runtime mode.
 * Boot is resolved once in the auth plugin. This file applies the org flag.
 */
import type { FastifyRequest } from 'fastify';

import { prisma } from '@bidstack/db';
import {
  NOT_CONNECTED,
  PROVIDER_IDS,
  actorMayToggle,
  applyOrgOverride,
  connectProvider,
  providerApprovalFromEnv,
  type RuntimeMode,
  type ToggleActor,
} from '@bidstack/shared';

import { canOverrideOwnership } from './org-admin.js';

export async function demoDataActor(req: FastifyRequest): Promise<ToggleActor> {
  if (req.auth.role === 'api' || req.auth.userId.startsWith('apikey:')) return 'api-key';
  const adminRoleCount = await prisma.userRole.count({
    where: {
      userId: req.auth.userId,
      deletedAt: null,
      user: { orgId: req.auth.orgId, deletedAt: null },
      role: { orgId: req.auth.orgId, name: 'Admin', deletedAt: null },
    },
  });
  if (adminRoleCount > 0) return 'admin';
  if (await canOverrideOwnership(req)) return 'owner';
  return 'member';
}

export async function orgDemoDataEnabled(orgId: string): Promise<boolean> {
  const row = await prisma.orgSettings.findFirst({
    where: { orgId, deletedAt: null },
    select: { demoData: true },
  });
  return row?.demoData === true;
}

export function modeForOrg(bootMode: RuntimeMode, orgDemoData: boolean | null): RuntimeMode {
  const applied = applyOrgOverride(bootMode.processData, orgDemoData);
  return { ...bootMode, effectiveData: applied.effectiveData };
}

export function providerSnapshot(env: NodeJS.ProcessEnv = process.env): Array<{
  id: (typeof PROVIDER_IDS)[number];
  status: 'approved' | typeof NOT_CONNECTED;
  enablePath: false;
}> {
  return PROVIDER_IDS.map((providerId) => {
    const decision = connectProvider(providerId, providerApprovalFromEnv(env, providerId));
    if (decision.ok) {
      return { id: providerId, status: 'approved' as const, enablePath: false as const };
    }
    return { id: providerId, status: NOT_CONNECTED, enablePath: false as const };
  });
}

export function legacyAuthProvider(mode: RuntimeMode): 'stub' | 'clerk' | 'demo' | 'cf-access' {
  if (mode.publicDemoDoor) return 'demo';
  return mode.auth ?? 'stub';
}

export function mayToggleDemoData(actor: ToggleActor): boolean {
  return actorMayToggle(actor);
}
