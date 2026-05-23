// DB row -> public API shape per openapi.yaml.
// Numbers come back from Prisma as Decimal/BigInt and need explicit conversion.

import type { Task, Document, OpportunityStage } from '@bidstack/db';
import type {
  Opportunity as ApiOpportunity,
  OpportunityFull as ApiOpportunityFull,
} from '@bidstack/shared';

type SerializedOwner = { id: string; name: string | null; email: string };
type SerializedOpportunity = {
  id: string;
  code: string;
  customer: string;
  name: string;
  stage: OpportunityStage;
  valueMicros: bigint | number;
  probability: number;
  dueDate: Date | null;
  industry: string | null;
  logoUrl: string | null;
  country: string | null;
  territoryId: string | null;
  updatedAt: Date;
  viewCount: number | null;
  intel: unknown;
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

export function serializeOpportunity(
  o: WithOwner & { territory?: { name: string } | null },
  counts?: OpportunityCounts,
): ApiOpportunity {
  return {
    id: o.id,
    code: o.code,
    customer: o.customer,
    name: o.name,
    stage: o.stage,
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
