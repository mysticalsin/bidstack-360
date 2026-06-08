import { describe, expect, it } from 'vitest';

import { makeSoftDeleteMiddleware } from './soft-delete.js';

describe('soft delete middleware', () => {
  it('keeps compound unique lookups valid after findUnique is rewritten', async () => {
    const middleware = makeSoftDeleteMiddleware();
    const params = {
      model: 'DashboardWidget',
      action: 'findUnique',
      args: {
        where: {
          orgId_kind: {
            orgId: '00000000-0000-4000-8000-000000000001',
            kind: 'provider_health',
          },
        },
      },
    };

    await middleware(params, async (rewritten) => rewritten);

    expect(params.action).toBe('findFirst');
    expect(params.args.where).toEqual({
      orgId: '00000000-0000-4000-8000-000000000001',
      kind: 'provider_health',
      deletedAt: null,
    });
  });

  it('respects explicit deletedAt filters for soft-delete assertions', async () => {
    const middleware = makeSoftDeleteMiddleware();
    const params = {
      model: 'ServiceCase',
      action: 'findFirst',
      args: {
        where: {
          id: '00000000-0000-4000-8000-000000000002',
          deletedAt: { not: null },
        },
      },
    };

    await middleware(params, async (rewritten) => rewritten);

    expect(params.args.where).toEqual({
      id: '00000000-0000-4000-8000-000000000002',
      deletedAt: { not: null },
    });
  });
});
