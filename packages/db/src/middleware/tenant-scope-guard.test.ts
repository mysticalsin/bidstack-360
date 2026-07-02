import { describe, expect, it } from 'vitest';

import { makeSoftDeleteMiddleware } from './soft-delete.js';
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

  it('rejects an orgId key whose value is undefined (Prisma drops undefined keys silently, so `{ orgId: undefined }` compiles to no orgId filter at all — the same all-tenants leak this guard exists to catch)', async () => {
    const middleware = makeTenantScopeGuardMiddleware({ mode: 'enforce' });
    const params = {
      model: 'Contact',
      action: 'findMany',
      args: { where: { orgId: undefined, customer: 'Acme' } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).rejects.toThrow(
      /Contact\.findMany must include orgId/,
    );
    expect(whereHasTenantScope({ orgId: undefined })).toBe(false);
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

  // findFirst takes an arbitrary `where` (identical shape to findMany), so it
  // can scan every org's rows just as easily as an unscoped findMany — full
  // enforcement applies, unlike the unique-key report-only ops below.
  it('rejects findFirst without orgId in enforce mode', async () => {
    const middleware = makeTenantScopeGuardMiddleware({ mode: 'enforce' });
    const params = {
      model: 'WebhookSubscription',
      action: 'findFirst',
      args: { where: { secretHash: 'hash' } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).rejects.toThrow(
      /WebhookSubscription\.findFirst must include orgId/,
    );
  });

  // findFirstOrThrow takes the identical arbitrary `where` as findFirst; if it
  // were missing from GUARDED_ACTIONS, swapping findFirst → findFirstOrThrow
  // would be a one-token bypass of the entire tenant guard.
  it('rejects findFirstOrThrow without orgId in enforce mode', async () => {
    const middleware = makeTenantScopeGuardMiddleware({ mode: 'enforce' });
    const params = {
      model: 'WebhookSubscription',
      action: 'findFirstOrThrow',
      args: { where: { secretHash: 'hash' } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).rejects.toThrow(
      /WebhookSubscription\.findFirstOrThrow must include orgId/,
    );
  });

  it('warns (does not throw) for findFirst without orgId in warn mode', async () => {
    const messages: string[] = [];
    const middleware = makeTenantScopeGuardMiddleware({
      mode: 'warn',
      onViolation: (message) => messages.push(message),
    });
    const params = {
      model: 'WebhookSubscription',
      action: 'findFirst',
      args: { where: { secretHash: 'hash' } },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).resolves.toBe(params);
    expect(messages).toEqual([
      '[tenant-scope-guard] WebhookSubscription.findFirst must include orgId in where before querying tenant data.',
    ]);
  });

  // findUnique/update/delete/upsert require a unique `where`, and orgId is
  // usually not part of the unique key — the repo's real pattern is fetch by
  // unique key then verify org ownership on the loaded row (see
  // tenantEntitiesBelongToOrg). Throwing here would break that pattern, so
  // these ops are report-only even in enforce mode: this feeds decision D2
  // (DB-level RLS vs AsyncLocalStorage backstop) with real usage data instead
  // of blocking a legitimate caller.
  it.each(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert'])(
    '%s without orgId does not throw in enforce mode, but reports the gap',
    async (action) => {
      const messages: string[] = [];
      const middleware = makeTenantScopeGuardMiddleware({
        mode: 'enforce',
        onViolation: (message) => messages.push(message),
      });
      const params = {
        model: 'WebhookSubscription',
        action,
        args: { where: { id: 'wh-1' } },
      };

      await expect(middleware(params, async (rewritten) => rewritten)).resolves.toBe(params);
      expect(messages).toEqual([
        '[tenant-scope-guard][report-only] WebhookSubscription.' +
          action +
          ' queried tenant data by unique key without orgId — verify caller did an org-scoped fetch first.',
      ]);
    },
  );

  // A composite-unique where (e.g. `@@unique([orgId, userId, provider])`)
  // nests orgId inside a synthetic key named after the joined fields —
  // `whereHasTenantScope` must recognize that shape as scoped so this
  // legitimate, already-org-scoped lookup isn't reported as a gap.
  it('treats a composite-unique key with a defined orgId as scoped (no violation)', async () => {
    const messages: string[] = [];
    const middleware = makeTenantScopeGuardMiddleware({
      mode: 'enforce',
      onViolation: (message) => messages.push(message),
    });
    const params = {
      model: 'IntegrationToken',
      action: 'findUnique',
      args: {
        where: {
          orgId_userId_provider: { orgId: 'org-1', userId: 'user-1', provider: 'google' },
        },
      },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).resolves.toBe(params);
    expect(messages).toEqual([]);
    expect(
      whereHasTenantScope({
        orgId_userId_provider: { orgId: 'org-1', userId: 'user-1', provider: 'google' },
      }),
    ).toBe(true);
  });

  // Same undefined-orgId leak as the top-level case: Prisma drops
  // `orgId: undefined` before it reaches SQL, so a composite key whose orgId
  // is undefined is exactly as unscoped as no orgId at all.
  it('treats a composite-unique key with an undefined orgId as a violation', async () => {
    expect(
      whereHasTenantScope({
        orgId_userId_provider: { orgId: undefined, userId: 'user-1', provider: 'google' },
      }),
    ).toBe(false);

    const messages: string[] = [];
    const middleware = makeTenantScopeGuardMiddleware({
      mode: 'enforce',
      onViolation: (message) => messages.push(message),
    });
    const params = {
      model: 'IntegrationToken',
      action: 'findUnique',
      args: {
        where: {
          orgId_userId_provider: { orgId: undefined, userId: 'user-1', provider: 'google' },
        },
      },
    };

    await expect(middleware(params, async (rewritten) => rewritten)).resolves.toBe(params);
    expect(messages).toEqual([
      '[tenant-scope-guard][report-only] IntegrationToken.findUnique queried tenant data by unique key without orgId — verify caller did an org-scoped fetch first.',
    ]);
  });

  // buildPrismaClient registers the guard BEFORE soft-delete because
  // soft-delete rewrites findUnique → findFirst in place. If the guard ran
  // second it would see the rewritten findFirst (a GUARDED action) instead of
  // the caller's findUnique (report-only), escalating every legitimate
  // fetch-by-unique-key on a soft-delete tenant model — including auth's
  // `user.findUnique({ where: { clerkUser } })` — into an enforce-mode throw:
  // a production outage at login. These tests pin the composed behavior so a
  // registration-order change cannot ship silently.
  describe('composed with soft-delete middleware (index.ts registration order)', () => {
    const findUniqueParams = () => ({
      model: 'User',
      action: 'findUnique',
      args: { where: { clerkUser: 'clerk-user-1' } },
    });

    it('guard-first: findUnique on a soft-delete tenant model stays report-only in enforce mode', async () => {
      const messages: string[] = [];
      const guard = makeTenantScopeGuardMiddleware({
        mode: 'enforce',
        onViolation: (message) => messages.push(message),
      });
      const softDelete = makeSoftDeleteMiddleware();
      const params = findUniqueParams();

      const result = await guard(params, (afterGuard) =>
        softDelete(afterGuard, async (final) => final),
      );

      // Soft-delete's rewrite still happens downstream of the guard.
      expect((result as { action: string }).action).toBe('findFirst');
      expect(messages).toEqual([
        '[tenant-scope-guard][report-only] User.findUnique queried tenant data by unique key without orgId — verify caller did an org-scoped fetch first.',
      ]);
    });

    it('soft-delete-first (the broken order) escalates findUnique to a hard enforce violation — kept as proof the registration order is load-bearing', async () => {
      const guard = makeTenantScopeGuardMiddleware({ mode: 'enforce' });
      const softDelete = makeSoftDeleteMiddleware();
      const params = findUniqueParams();

      await expect(
        softDelete(params, (afterSoftDelete) => guard(afterSoftDelete, async (final) => final)),
      ).rejects.toThrow(/User\.findFirst must include orgId/);
    });
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
