// DB row -> public API shape per openapi.yaml.
// Numbers come back from Prisma as Decimal/BigInt and need explicit conversion.

import type { Task, Document, OpportunityStage } from '@bidstack/db';
import type {
  Opportunity as ApiOpportunity,
  OpportunityFull as ApiOpportunityFull,
} from '@bidstack/shared';

type SerializedOwner = { id: string; name: string | null; email: string };
type SerializedPipelineStage = {
  id: string;
  name: string;
  probability: number;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
};
type SerializedOpportunity = {
  id: string;
  code: string;
  customer: string;
  name: string;
  stage: OpportunityStage;
  pipelineStageId: string | null;
  pipelineStage: { id: string; name: string; probability: number | unknown; color: string | null; isWon?: boolean; isLost?: boolean } | null;
  valueMicros: bigint | number;
  probability: number;
  dueDate: Date | null;
  industry: string | null;
  logoUrl: string | null;
  country: string | null;
  territoryId: string | null;
  updatedAt: Date;
  viewCount: number | null;
  // Only the detail/full path reads intel; the list query omits the column to
  // avoid fetching the large JSONB per row, so this is optional here.
  intel?: unknown;
};
type WithOwner = SerializedOpportunity & { owner: SerializedOwner | null };
type Full = WithOwner & {
  territory?: { name: string } | null;
  tasks: Task[];
  documents: Document[];
};

export interface OpportunityCounts {
  taskCount?: number;
  commentCount?: number;
}

function serializePipelineStage(
  ps: { id: string; name: string; probability: number | bigint | unknown; color: string | null; isWon?: boolean; isLost?: boolean } | null | undefined,
): SerializedPipelineStage | null {
  if (!ps) return null;
  return {
    id: ps.id,
    name: ps.name,
    probability: typeof ps.probability === 'number' ? ps.probability : Number(ps.probability),
    color: ps.color ?? null,
    isWon: ps.isWon ?? false,
    isLost: ps.isLost ?? false,
  };
}

export function serializeOpportunity(
  o: WithOwner & { territory?: { name: string } | null },
  counts?: OpportunityCounts,
): ApiOpportunity {
  return {
    id: o.id,
    code: o.code,
    customer: o.customer,
    name: o.name,
    stage: o.pipelineStage?.name ?? o.stage ?? null,
    pipelineStageId: o.pipelineStageId ?? null,
    pipelineStage: serializePipelineStage(o.pipelineStage),
    value: Number(o.valueMicros) / 1_000_000,
    probability: o.probability,
    dueDate: o.dueDate ? o.dueDate.toISOString().slice(0, 10) : null,
    owner: o.owner?.email ?? null,
    industry: o.industry ?? null,
    logo: o.logoUrl,
    country: o.country ?? null,
    territoryId: o.territoryId ?? null,
    territoryName: o.territory?.name ?? null,
    updatedAt: o.updatedAt.toISOString(),
    taskCount: counts?.taskCount ?? 0,
    commentCount: counts?.commentCount ?? 0,
    viewCount: o.viewCount ?? 0,
  };
}

export function serializeOpportunityFull(o: Full): ApiOpportunityFull {
  return {
    ...serializeOpportunity(o),
    intel: o.intel as ApiOpportunityFull['intel'],
    tasks: o.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    })),
    documents: o.documents.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      bytes: d.bytes ? Number(d.bytes) : null,
      createdAt: d.createdAt.toISOString(),
    })),
    timeline: [],
  };
}
