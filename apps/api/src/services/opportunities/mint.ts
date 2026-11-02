/**
 * mint.ts — the shared Opportunity-mint primitive.
 *
 * WHY this exists (red-team B1): the OP-code mint + pipeline-stage resolution +
 * bounded unique-violation retry used to live inline inside the lead-convert
 * route. The KAM Initiative→Opportunity boundary needs the SAME subtle logic;
 * copying ~40 lines guarantees drift. This module is the single source of that
 * primitive — both `POST /leads/:id/convert` and the KAM transition call it.
 *
 * Scope: the opportunity-creation sub-routine ONLY. Lead-specific steps
 * (Contact create, lead status flip) stay in the lead route; KAM-specific steps
 * (KamHandoff, initiative flip) stay in the KAM route.
 */
import { type Prisma } from '@bidstack/db';

import {
  isUniqueViolation,
  mintNextCode,
  resolveCompanyIdByName,
} from '../../routes/opportunities.helpers.js';

export interface MintOpportunityInput {
  orgId: string;
  customer: string;
  name: string;
  /**
   * Set for KAM (initiative.companyId). When omitted (e.g. lead-convert), the
   * mint resolves an EXISTING Company by normalized `customer` name — link-only,
   * never auto-created — so converted opps roll up into the account views (F2).
   */
  companyId?: string | null;
  valueMicros?: bigint;
  ownerId?: string | null;
  probability?: number;
  /** Resolution priority: explicit pipelineStageId > legacy stageKey > org default. */
  pipelineStageId?: string | null;
  stageKey?: string | null;
}

/**
 * Resolve the pipeline stage for a new opportunity, mirroring the lead-convert
 * priority exactly: explicit `pipelineStageId` → legacy `stageKey` → the org's
 * lowest-orderIndex stage. Returns the resolved id (or undefined) and the legacy
 * enum key to persist on `Opportunity.stage`.
 */
export async function resolvePipelineStage(
  tx: Prisma.TransactionClient,
  orgId: string,
  opts: { pipelineStageId?: string | null; stageKey?: string | null },
): Promise<{ pipelineStageId: string | undefined; stageKey: string }> {
  let pipelineStageId: string | undefined;
  let stageKey = 's1_lead';
  if (opts.pipelineStageId) {
    const ps = await tx.pipelineStage.findFirst({
      where: { id: opts.pipelineStageId, orgId, deletedAt: null },
      select: { key: true },
    });
    if (ps) {
      pipelineStageId = opts.pipelineStageId;
      stageKey = ps.key;
    }
  } else if (opts.stageKey) {
    stageKey = opts.stageKey;
    const ps = await tx.pipelineStage.findFirst({
      where: { key: opts.stageKey, orgId, deletedAt: null },
      select: { id: true },
    });
    if (ps) pipelineStageId = ps.id;
  } else {
    const defaultStage = await tx.pipelineStage.findFirst({
      where: { orgId, deletedAt: null },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, key: true },
    });
    if (defaultStage) {
      pipelineStageId = defaultStage.id;
      stageKey = defaultStage.key;
    }
  }
  return { pipelineStageId, stageKey };
}

/**
 * Mint an Opportunity inside an existing transaction: next OP-code + stage
 * resolution + create. The caller MUST wrap this in `withOpportunityCodeRetry`
 * because `mintNextCode` reads inside the tx and a concurrent create/convert
 * can race the (orgId, code) unique key.
 */
export async function mintOpportunityTx(
  tx: Prisma.TransactionClient,
  input: MintOpportunityInput,
) {
  const code = await mintNextCode(tx, input.orgId);
  const { pipelineStageId, stageKey } = await resolvePipelineStage(tx, input.orgId, {
    pipelineStageId: input.pipelineStageId,
    stageKey: input.stageKey,
  });
  // Honor an explicit companyId (KAM); otherwise link-only-if-exists by name.
  const companyId =
    input.companyId ?? (await resolveCompanyIdByName(tx, input.orgId, input.customer));
  return tx.opportunity.create({
    data: {
      orgId: input.orgId,
      code,
      customer: input.customer,
      name: input.name,
      stage: stageKey as 's1_lead',
      pipelineStageId,
      companyId,
      valueMicros: input.valueMicros ?? BigInt(0),
      probability: input.probability ?? 20,
      ownerId: input.ownerId ?? null,
    },
  });
}

/**
 * Run `run` with a bounded retry (5 attempts) on (orgId, code) unique
 * violations. Identical to the lead-convert loop it replaces.
 */
export async function withOpportunityCodeRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= 4) throw err;
    }
  }
}
