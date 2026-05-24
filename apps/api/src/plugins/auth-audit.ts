// Append-only audit log writes for authentication events.
//
// Why a thin helper instead of inline writes: every call site needs the same
// {ip, userAgent} extraction and the same fire-and-forget error handling
// (an audit-log write failure must NOT cascade into a 5xx for the caller).
// Centralising the pattern also lets us evolve the schema (add fields, change
// sampling) in one place when the AuditLog model picks up dedicated columns
// for ip/user_agent.
//
// Tenancy: every entry is scoped to orgId by Prisma — see the schema. This
// helper enforces that orgId is non-empty so the constraint never bites in
// production.

import type { FastifyRequest } from 'fastify';
import type { Prisma } from '@bidstack/db';
import { prisma } from '@bidstack/db';

export type AuthAuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.role_change'
  | 'apikey.used';

interface WriteOpts {
  action: AuthAuditAction;
  orgId: string;
  /** UUID of the user this event is about, when known. For login_failed
   *  attempts we may have no userId yet — the field is left null. */
  actorUserId: string | null;
  /** Optional target reference (e.g. the targeted user for a role-change). */
  targetType?: string;
  targetId?: string;
  /** Structured diff. ip + userAgent get merged in by the helper. */
  diff: Record<string, unknown>;
}

/** Extract client IP + user-agent from a Fastify request. Returns nulls
 *  rather than empty strings so the audit log entry is unambiguous. */
export function clientFingerprint(req: FastifyRequest): {
  ip: string | null;
  userAgent: string | null;
} {
  const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null;
  const ua = req.headers['user-agent'];
  const userAgent = typeof ua === 'string' && ua.length > 0 ? ua : null;
  return { ip, userAgent };
}

/** Write an auth audit-log entry. Fire-and-forget: a Prisma error is
 *  logged via pino but never bubbles back to the caller, so audit writes
 *  can never break a sign-in flow. */
export async function writeAuthAudit(req: FastifyRequest, opts: WriteOpts): Promise<void> {
  if (!opts.orgId) {
    // Defensive — audit_log.org_id is NOT NULL in the schema. Logging the
    // skip is more useful than crashing the caller.
    req.log.warn({ action: opts.action }, 'auth-audit skipped: orgId is empty');
    return;
  }

  const { ip, userAgent } = clientFingerprint(req);
  const diff: Prisma.InputJsonValue = {
    ...opts.diff,
    ip,
    userAgent,
  };

  try {
    await prisma.auditLog.create({
      data: {
        orgId: opts.orgId,
        userId: opts.actorUserId,
        action: opts.action,
        targetType: opts.targetType ?? null,
        targetId: opts.targetId ?? null,
        diff,
      },
    });
  } catch (err) {
    // Audit-log failures are surfaced but do not propagate: signing in must
    // never 5xx because the audit table is unwritable. The Pino log line
    // will trigger an SLO alert via the standard "audit write failure"
    // metric path (see docs/audits/2026-05-24-twenty-agent-deep-audit.md
    // recommendation R-MON-4).
    req.log.warn(
      { err, action: opts.action, orgId: opts.orgId, userId: opts.actorUserId },
      'auth audit-log write failed',
    );
  }
}
