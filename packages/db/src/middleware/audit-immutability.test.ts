import { describe, expect, it, vi } from 'vitest';

import { makeAuditImmutabilityMiddleware } from './audit-immutability.js';

describe('audit immutability middleware', () => {
  const blocked = ['update', 'updateMany', 'delete', 'deleteMany', 'upsert'] as const;

  for (const action of blocked) {
    it(`blocks ${action} on AuditLog so audit history cannot be altered`, async () => {
      const middleware = makeAuditImmutabilityMiddleware();
      const next = vi.fn(async (p) => p);

      await expect(
        // WHY: a blocked mutation must reject before reaching the DB, not silently
        // pass through — tamper-resistance is the whole point of the guard.
        middleware({ model: 'AuditLog', action, args: { where: { id: 1n } } }, next),
      ).rejects.toThrow(/insert-only/);

      expect(next).not.toHaveBeenCalled();
    });
  }

  it('allows create on AuditLog (insert is the only permitted mutation)', async () => {
    const middleware = makeAuditImmutabilityMiddleware();
    const next = vi.fn(async (p) => p);
    const params = { model: 'AuditLog', action: 'create', args: { data: {} } };

    await middleware(params, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('allows reads on AuditLog', async () => {
    const middleware = makeAuditImmutabilityMiddleware();
    const next = vi.fn(async (p) => p);

    await middleware({ model: 'AuditLog', action: 'findMany', args: {} }, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('does not block mutations on other models', async () => {
    const middleware = makeAuditImmutabilityMiddleware();
    const next = vi.fn(async (p) => p);

    await middleware({ model: 'Lead', action: 'update', args: { where: { id: '1' } } }, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
