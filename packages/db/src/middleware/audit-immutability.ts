import type { Prisma } from '../../generated/client/index.js';

/**
 * Audit immutability middleware.
 *
 * WHY: EU AI Act Art. 12 / GDPR Art. 30 require audit trails to be tamper-evident.
 * AuditLog is an ordinary mutable Prisma model, so any code path (or a compromised
 * one) could silently rewrite or erase audit history. This middleware makes audit
 * rows INSERT-only at the application layer: create reads/finds pass through, but
 * every mutation that could alter or remove an existing row is blocked.
 *
 * Blocked actions on AuditLog: update, updateMany, delete, deleteMany, upsert.
 * (upsert is blocked because its update branch can mutate an existing row.)
 *
 * ── Allowed delete path (retention purge) ──────────────────────────────────
 * The 90-day retention purge (apps/worker ai-audit-retention) deletes expired
 * rows via prisma.$executeRaw. Raw SQL does NOT pass through Prisma $use
 * middleware, so the purge is structurally exempt — no shared mutable flag or
 * symbol has to be threaded through the client to grant the exception.
 *
 * WHY $executeRaw over a middleware-level flag: a flag the purge sets/clears is
 * an ambient, racy escape hatch any caller could reach for; the raw-SQL boundary
 * is explicit and can itself be locked down further with a DB role. The
 * retention worker and test teardown are the callers. Keeping the exception
 * OUT of this middleware keeps the rule here unconditional.
 *
 * DB-level layer: migration 20261107070020_audit_log_hash_chain_triggers adds triggers
 * that hash-chain every insert per org and reject content UPDATE and TRUNCATE
 * for every writer, raw SQL included. DELETE stays possible for the retention
 * purge and org cascade; chain verification reports the gap it leaves.
 * Remaining follow-up: REVOKE DELETE ON audit_log from the app role so only the
 * retention role may purge.
 */

const AUDIT_MODEL = 'AuditLog';

const BLOCKED_ACTIONS = new Set<Prisma.PrismaAction>([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

export function makeAuditImmutabilityMiddleware(): Prisma.Middleware {
  return async (params, next) => {
    if (params.model === AUDIT_MODEL && BLOCKED_ACTIONS.has(params.action)) {
      throw new Error(
        `AuditLog is insert-only: '${params.action}' is not permitted. ` +
          `Audit rows are immutable; expired rows are removed only by the ` +
          `retention purge via raw SQL.`,
      );
    }
    return next(params);
  };
}
