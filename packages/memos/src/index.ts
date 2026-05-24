import { prisma, type Prisma } from '@bidstack/db';

export interface TraceEvent {
  orgId: string;
  tier: 'l1' | 'l2' | 'l3';
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  userId: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PolicyInsight {
  orgId: string;
  key: string;
  category: string;
  scopeType: 'account' | 'territory' | 'global' | 'opportunity';
  scopeId?: string;
  insight: string;
  confidence: number;
  evidence?: Record<string, unknown>;
  sourceTraces?: string[];
}

export interface WorldModelUpdate {
  orgId: string;
  domain: string;
  key: string;
  value: Record<string, unknown>;
  trend?: 'up' | 'down' | 'stable';
  relevance?: number;
  expiresAt: Date;
}

export interface MemoryFilter {
  orgId: string;
  tier?: 'l1' | 'l2' | 'l3';
  module?: string;
  entityType?: string;
  entityId?: string;
  category?: string;
  scopeType?: string;
  scopeId?: string;
  domain?: string;
  active?: boolean;
  limit?: number;
  after?: Date;
}

export interface MemoryItem {
  id: string;
  tier: string;
  module?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  category?: string;
  key?: string;
  insight?: string;
  value?: Record<string, unknown>;
  confidence?: number;
  relevance?: number;
  createdAt: Date;
}

export class MemOSService {
  private db: Prisma.TransactionClient | typeof prisma;

  constructor(db: Prisma.TransactionClient | typeof prisma = prisma) {
    this.db = db;
  }

  async logTrace(event: TraceEvent): Promise<void> {
    await this.db.memosTrace.create({
      data: {
        orgId: event.orgId,
        tier: event.tier,
        module: event.module,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        userId: event.userId,
        payload: event.payload as Prisma.InputJsonValue,
        metadata: (event.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async crystallizePolicy(insight: PolicyInsight): Promise<void> {
    await this.db.memosPolicy.upsert({
      where: {
        orgId_key: { orgId: insight.orgId, key: insight.key },
      },
      update: {
        insight: insight.insight,
        confidence: insight.confidence,
        evidence: (insight.evidence ?? {}) as Prisma.InputJsonValue,
        sourceTraces: insight.sourceTraces ?? [],
        updatedAt: new Date(),
      },
      create: {
        orgId: insight.orgId,
        key: insight.key,
        category: insight.category,
        scopeType: insight.scopeType,
        scopeId: insight.scopeId,
        insight: insight.insight,
        confidence: insight.confidence,
        evidence: (insight.evidence ?? {}) as Prisma.InputJsonValue,
        sourceTraces: insight.sourceTraces ?? [],
      },
    });
  }

  async updateWorldModel(update: WorldModelUpdate): Promise<void> {
    await this.db.memosWorldModel.upsert({
      where: {
        orgId_domain_key: { orgId: update.orgId, domain: update.domain, key: update.key },
      },
      update: {
        value: update.value as Prisma.InputJsonValue,
        trend: update.trend,
        relevance: update.relevance ?? 5000,
        expiresAt: update.expiresAt,
        updatedAt: new Date(),
      },
      create: {
        orgId: update.orgId,
        domain: update.domain,
        key: update.key,
        value: update.value as Prisma.InputJsonValue,
        trend: update.trend,
        relevance: update.relevance ?? 5000,
        expiresAt: update.expiresAt,
      },
    });
  }

  async retrieveContext(_query: string, filters: MemoryFilter): Promise<MemoryItem[]> {
    const limit = filters.limit ?? 20;
    const items: MemoryItem[] = [];

    if (!filters.orgId) {
      throw new Error('MemOS retrieval requires an orgId');
    }

    if (!filters.tier || filters.tier === 'l1') {
      const traces = await this.db.memosTrace.findMany({
        where: {
          orgId: filters.orgId,
          ...(filters.module ? { module: filters.module } : {}),
          ...(filters.entityType ? { entityType: filters.entityType } : {}),
          ...(filters.entityId ? { entityId: filters.entityId } : {}),
          ...(filters.after ? { createdAt: { gte: filters.after } } : {}),
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      items.push(
        ...traces.map((t) => ({
          id: t.id,
          tier: t.tier,
          module: t.module ?? undefined,
          entityType: t.entityType ?? undefined,
          entityId: t.entityId ?? undefined,
          action: t.action ?? undefined,
          createdAt: t.createdAt,
        })),
      );
    }

    if (!filters.tier || filters.tier === 'l2') {
      const policies = await this.db.memosPolicy.findMany({
        where: {
          orgId: filters.orgId,
          ...(filters.category ? { category: filters.category } : {}),
          ...(filters.scopeType ? { scopeType: filters.scopeType } : {}),
          ...(filters.scopeId ? { scopeId: filters.scopeId } : {}),
          ...(filters.active !== undefined ? { active: filters.active } : { active: true }),
          deletedAt: null,
        },
        orderBy: { confidence: 'desc' },
        take: limit,
      });
      items.push(
        ...policies.map((p) => ({
          id: p.id,
          tier: 'l2' as const,
          category: p.category ?? undefined,
          key: p.key,
          insight: p.insight ?? undefined,
          confidence: p.confidence ?? undefined,
          createdAt: p.createdAt,
        })),
      );
    }

    if (!filters.tier || filters.tier === 'l3') {
      const models = await this.db.memosWorldModel.findMany({
        where: {
          orgId: filters.orgId,
          ...(filters.domain ? { domain: filters.domain } : {}),
          expiresAt: { gt: new Date() },
          deletedAt: null,
        },
        orderBy: { relevance: 'desc' },
        take: limit,
      });
      items.push(
        ...models.map((m) => ({
          id: m.id,
          tier: 'l3' as const,
          key: m.key,
          value: (m.value as Record<string, unknown> | null) ?? undefined,
          relevance: m.relevance ?? undefined,
          createdAt: m.createdAt,
        })),
      );
    }

    return items
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getPoliciesForScope(
    orgId: string,
    scopeType: string,
    scopeId?: string,
    category?: string,
    limit = 10,
  ): Promise<MemoryItem[]> {
    return this.retrieveContext('', {
      orgId,
      tier: 'l2',
      scopeType,
      scopeId,
      category,
      limit,
    });
  }

  async ingestDocument(doc: {
    orgId: string;
    name: string;
    content: string;
    projectId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.logTrace({
      orgId: doc.orgId,
      tier: 'l1',
      module: 'kb',
      entityType: 'document',
      entityId: doc.projectId,
      action: 'ingest',
      userId: 'system',
      payload: { name: doc.name, size: doc.content.length, projectId: doc.projectId },
      metadata: doc.metadata,
    });
  }
}

export { MemOSService as default };
