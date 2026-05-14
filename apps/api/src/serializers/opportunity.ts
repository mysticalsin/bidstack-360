// DB row -> public API shape per openapi.yaml.
// Numbers come back from Prisma as Decimal/BigInt and need explicit conversion.

import type { Opportunity, User, Task, Document } from '@bidstack/db';
import type { Opportunity as ApiOpportunity } from '@bidstack/shared';

type WithOwner = Opportunity & { owner: User | null };
type Full = WithOwner & { tasks: Task[]; documents: Document[] };

export function serializeOpportunity(o: WithOwner): ApiOpportunity {
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
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function serializeOpportunityFull(o: Full) {
  return {
    ...serializeOpportunity(o),
    intel: o.intel,
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
  };
}
