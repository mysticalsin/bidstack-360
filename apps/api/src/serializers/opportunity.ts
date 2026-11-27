// DB row -> public API shape per openapi.yaml.
// Numbers come back from Prisma as Decimal/BigInt and need explicit conversion.

import type { Task, Document, OpportunityStage } from '@bidstack/db';
import {
  microsToUnits,
  projectFixtureOpportunityDueDate,
  type Opportunity as ApiOpportunity,
  type OpportunityFull as ApiOpportunityFull,
} from '@bidstack/shared';

import { getPoloDataMode } from '../lib/polo-mode.js';

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
  closedAt?: Date | null;
  viewCount: number | null;
  bidClass?: string | null;
  fteEstimate?: number | null;
  commitmentLevel?: string | null;
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

function projectedDueDate(
  o: Pick<SerializedOpportunity, 'code' | 'stage' | 'dueDate' | 'pipelineStage'>,
  now: Date,
): string | null {
  if (!o.dueDate) return null;
  const projected = projectFixtureOpportunityDueDate(
    {
      code: o.code,
      stage: o.stage,
      dueDate: o.dueDate,
      pipelineStage: o.pipelineStage,
    },
    now,
    getPoloDataMode(),
  );
  if (projected == null || !(projected instanceof Date)) return null;
  return projected.toISOString().slice(0, 10);
}

export function serializeOpportunity(
  o: WithOwner & { territory?: { name: string } | null },
  counts?: OpportunityCounts,
  now: Date = new Date(),
): ApiOpportunity {
  return {
    id: o.id,
    code: o.code,
    customer: o.customer,
    name: o.name,
    stage: o.pipelineStage?.name ?? o.stage ?? null,
    pipelineStageId: o.pipelineStageId ?? null,
    pipelineStage: serializePipelineStage(o.pipelineStage),
    // WHY microsToUnits (not Number(x) / 1_000_000): the naive form rounds
    // BigInt→Number before dividing, so a deal past ~$9.007B silently
    // corrupts on the wire. Storage stays micros.
    value: microsToUnits(o.valueMicros),
    probability: o.probability,
    dueDate: projectedDueDate(o, now),
    owner: o.owner?.email ?? null,
    industry: o.industry ?? null,
    logo: o.logoUrl,
    country: o.country ?? null,
    territoryId: o.territoryId ?? null,
    territoryName: o.territory?.name ?? null,
    updatedAt: o.updatedAt.toISOString(),
    closedAt: o.closedAt ? o.closedAt.toISOString() : null,
    taskCount: counts?.taskCount ?? 0,
    commentCount: counts?.commentCount ?? 0,
    viewCount: o.viewCount ?? 0,
    bidClass: o.bidClass ?? null,
    fteEstimate: o.fteEstimate ?? null,
    commitmentLevel: o.commitmentLevel ?? null,
  };
}

export function serializeOpportunityFull(o: Full, now: Date = new Date()): ApiOpportunityFull {
  return {
    ...serializeOpportunity(o, undefined, now),
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
