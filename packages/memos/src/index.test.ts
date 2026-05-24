import { describe, expect, it, vi } from 'vitest';
import { MemOSService } from './index.js';

function buildMemosDb() {
  const db = {
    memosTrace: { findMany: vi.fn().mockResolvedValue([]) },
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
    await service.getPoliciesForScope('org-a', 'opportunity', '00000000-0000-0000-0000-000000000001');
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
