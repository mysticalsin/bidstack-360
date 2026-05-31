import { describe, expect, it, vi } from 'vitest';
import { MemOSService } from './index.js';

function buildMemosDb() {
  const db = {
    memosTrace: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    memosPolicy: { findMany: vi.fn().mockResolvedValue([]) },
    memosWorldModel: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    db,
    service: new MemOSService(db as unknown as ConstructorParameters<typeof MemOSService>[0]),
  };
}

describe('MemOSService tenant isolation', () => {
  it('scopes policy retrieval by orgId', async () => {
    const { db, service } = buildMemosDb();
    await service.getPoliciesForScope(
      'org-a',
      'opportunity',
      '00000000-0000-0000-0000-000000000001',
    );
    expect(db.memosPolicy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'org-a',
          scopeType: 'opportunity',
          scopeId: '00000000-0000-0000-0000-000000000001',
          active: true,
          deletedAt: null,
        }),
      }),
    );
  });

  it('scopes world-model retrieval by orgId', async () => {
    const { db, service } = buildMemosDb();
    await service.retrieveContext('', {
      orgId: 'org-a',
      tier: 'l3',
      domain: 'win_rate',
      limit: 5,
    });
    expect(db.memosWorldModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'org-a',
          domain: 'win_rate',
          deletedAt: null,
        }),
      }),
    );
  });
});

describe('MemOSService.logTrace actor coercion', () => {
  const baseEvent = {
    orgId: '00000000-0000-0000-0000-0000000000aa',
    tier: 'l1' as const,
    module: 'rfp',
    entityType: 'requirement',
    entityId: '00000000-0000-0000-0000-0000000000bb',
    action: 'story_match_complete',
    payload: { matchCount: 3 },
  };

  it('stores NULL and keeps the original actor for non-UUID sentinels', async () => {
    // WHY: 'system' is not a UUID and user_id is a UUID column with no FK, so a
    // literal sentinel triggers Prisma P2023. The actor must be nulled (and kept
    // in metadata) so system-initiated traces persist instead of being dropped.
    const { db, service } = buildMemosDb();
    await service.logTrace({ ...baseEvent, userId: 'system' });
    expect(db.memosTrace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
          metadata: expect.objectContaining({ actor: 'system' }),
        }),
      }),
    );
  });

  it('passes a real UUID actor through and adds no actor metadata', async () => {
    // WHY: genuine users (e.g. bid-score authors) must keep their id so the
    // [orgId, userId] index and audit trail stay accurate.
    const { db, service } = buildMemosDb();
    const userId = '11111111-2222-3333-4444-555555555555';
    await service.logTrace({ ...baseEvent, userId, metadata: { source: 'ui' } });
    const data = db.memosTrace.create.mock.calls[0]?.[0]?.data;
    expect(data.userId).toBe(userId);
    expect(data.metadata).toEqual({ source: 'ui' });
    expect(data.metadata).not.toHaveProperty('actor');
  });
});
