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

  it('scopes update to live rows so a soft-deleted record cannot be mutated', async () => {
    const middleware = makeSoftDeleteMiddleware();
    const params = {
      model: 'Lead',
      action: 'update',
      args: {
        where: { id: '00000000-0000-4000-8000-000000000003' },
        data: { status: 'qualified' },
      },
    };

    await middleware(params, async (rewritten) => rewritten);

    // WHY: without deletedAt: null an update could resurrect/edit a tombstoned row.
    expect(params.args.where).toEqual({
      id: '00000000-0000-4000-8000-000000000003',
      deletedAt: null,
    });
  });

  it('scopes updateMany to live rows', async () => {
    const middleware = makeSoftDeleteMiddleware();
    const params = {
      model: 'Contact',
      action: 'updateMany',
      args: { where: { orgId: 'org-1' }, data: { customer: 'x' } },
    };

    await middleware(params, async (rewritten) => rewritten);

    expect(params.args.where).toEqual({ orgId: 'org-1', deletedAt: null });
  });

  it('lets an explicit deletedAt filter bypass update scoping (e.g. restore)', async () => {
    const middleware = makeSoftDeleteMiddleware();
    const params = {
      model: 'Lead',
      action: 'update',
      args: {
        where: { id: 'x', deletedAt: { not: null } },
        data: { deletedAt: null },
      },
    };

    await middleware(params, async (rewritten) => rewritten);

    expect(params.args.where).toEqual({ id: 'x', deletedAt: { not: null } });
  });

  it('does not scope delete — hard delete stays the teardown/admin path', async () => {
    const middleware = makeSoftDeleteMiddleware();
    const params = {
      model: 'Contact',
      action: 'delete',
      args: { where: { id: 'x' } },
    };

    await middleware(params, async (rewritten) => rewritten);

    expect(params.args.where).toEqual({ id: 'x' });
  });
});
