import { describe, expect, it } from 'vitest';

import { makeTenantScopeGuardMiddleware, whereHasTenantScope } from './tenant-scope-guard.js';

describe('tenant scope guard middleware', () => {
  it('rejects tenant model list reads without orgId in enforce mode', async () => {
    const middleware = makeTenantScopeGuardMiddleware({ mode: 'enforce' });
    const params = {
      model: 'Contact',
      action: 'findMany',
      args: { where: { customer: 'Acme' } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).rejects.toThrow(
      /Contact\.findMany must include orgId/,
    );
  });

  it('allows tenant model list reads with a direct orgId scope', async () => {
    const middleware = makeTenantScopeGuardMiddleware({ mode: 'enforce' });
    const params = {
      model: 'Opportunity',
      action: 'findMany',
      args: { where: { orgId: 'org-1', stage: 's1_lead' } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).resolves.toBe(params);
  });

  it('allows AND filters where orgId scopes the whole predicate', () => {
    expect(
      whereHasTenantScope({
        AND: [{ orgId: 'org-1' }, { stage: 's1_lead' }],
      }),
    ).toBe(true);
  });

  it('allows OR filters only when every branch has orgId', () => {
    expect(
      whereHasTenantScope({
        OR: [
          { orgId: 'org-1', customer: 'Acme' },
          { orgId: 'org-1', customer: 'Globex' },
        ],
      }),
    ).toBe(true);

    expect(
      whereHasTenantScope({
        OR: [{ orgId: 'org-1', customer: 'Acme' }, { customer: 'Globex' }],
      }),
    ).toBe(false);
  });

  it('does not block non-tenant models', async () => {
    const middleware = makeTenantScopeGuardMiddleware({ mode: 'enforce' });
    const params = {
      model: 'Org',
      action: 'findMany',
      args: { where: { name: { contains: 'Mantu' } } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).resolves.toBe(params);
  });

  it('leaves single-record ownership-resolution paths alone in this first backstop', async () => {
    const middleware = makeTenantScopeGuardMiddleware({ mode: 'enforce' });
    const params = {
      model: 'WebhookSubscription',
      action: 'findFirst',
      args: { where: { secretHash: 'hash' } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).resolves.toBe(params);
  });

  it('warns without blocking when configured in warn mode', async () => {
    const messages: string[] = [];
    const middleware = makeTenantScopeGuardMiddleware({
      mode: 'warn',
      onViolation: (message) => messages.push(message),
    });
    const params = {
      model: 'Lead',
      action: 'count',
      args: { where: { status: 'new' } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).resolves.toBe(params);
    expect(messages).toEqual([
      '[tenant-scope-guard] Lead.count must include orgId in where before querying tenant data.',
    ]);
  });
});
