// Per-key authentication for MCP tool calls.
// Resolves Bearer token -> ApiKey row -> AuthCtx { orgId, scopes, keyId }.
// Updates lastUsedAt on every call, and emits a 1%-sampled
// `apikey.used` audit-log row so breach back-tracing has a trail without
// dwarfing user audit traffic.

import { createHash, randomInt } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Prisma, PrismaClient } from '@bidstack/db';

/**
 * Probability of emitting an `apikey.used` audit-log row for a given
 * authenticated MCP request. MCP tool calls are high-volume; logging every
 * one would dwarf interactive user audit traffic and balloon the table by
 * an order of magnitude. 1 in 100 gives us enough sample density to detect
 * anomalous usage patterns and back-trace breaches without dominating
 * storage.
 *
 * Sampling uses crypto.randomInt rather than Math.random so an attacker
 * who controls the timing of their requests cannot predict which calls
 * will land in the audit log.
 */
export const APIKEY_USED_SAMPLE_RATE = 0.01;

/** Test seam: when set, replaces the random sampling decision so tests can
 *  force inclusion (true) or exclusion (false). Production callers must
 *  leave this null. */
let sampleOverride: boolean | null = null;
export function __setApikeyUsedSampleForTest(value: boolean | null): void {
  sampleOverride = value;
}

function shouldSample(): boolean {
  if (sampleOverride !== null) return sampleOverride;
  // randomInt(0, 10_000) yields a uniform distribution in [0, 10000); 100
  // values out of 10_000 = exactly 1%. crypto.randomInt is non-blocking
  // here because the range fits in a single byte read.
  return randomInt(0, 10_000) < Math.floor(APIKEY_USED_SAMPLE_RATE * 10_000);
}

export interface McpAuthCtx {
  orgId: string;
  keyId: string;
  scopes: string[];
}

export function requireMcpScope(ctx: McpAuthCtx, scope: 'read' | 'write'): void {
  if (!ctx.scopes.includes(scope)) {
    throw new Error(`API key lacks \`${scope}\` scope`);
  }
}

/** Build the structured diff for an apikey.used audit entry. The full token
 *  is NEVER recorded — only its 12-character prefix and a few request
 *  fingerprint fields. */
function apikeyUsedDiff(
  keyPrefix: string,
  scopes: string[],
  req: FastifyRequest,
): Prisma.InputJsonValue {
  const ua = req.headers['user-agent'];
  return {
    keyPrefix,
    scopes,
    path: req.url.split('?')[0],
    method: req.method,
    ip: typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null,
    userAgent: typeof ua === 'string' && ua.length > 0 ? ua : null,
  };
}

export async function mcpAuth(req: FastifyRequest, prisma: PrismaClient): Promise<McpAuthCtx> {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw req.server.httpErrors.unauthorized('Bearer token required');
  }
  const token = auth.slice(7).trim();
  if (!token) throw req.server.httpErrors.unauthorized('Empty token');

  const hashedKey = createHash('sha256').update(token).digest('hex');
  const key = await prisma.apiKey.findFirst({
    where: { hashedKey, revokedAt: null },
  });
  if (!key) throw req.server.httpErrors.unauthorized('Invalid API key');
  if (!key.scopes.includes('mcp')) {
    throw req.server.httpErrors.forbidden('API key lacks `mcp` scope');
  }

  // Fire-and-forget update of lastUsedAt
  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  // Sampled audit-log entry — see APIKEY_USED_SAMPLE_RATE comment for why
  // this isn't 100%. Await it for deterministic audit semantics, but swallow
  // failures so an audit outage cannot 5xx the MCP request.
  if (shouldSample()) {
    await prisma.auditLog
      .create({
        data: {
          orgId: key.orgId,
          userId: null,
          action: 'apikey.used',
          targetType: 'api_key',
          targetId: key.id,
          diff: apikeyUsedDiff(key.prefix, key.scopes, req),
        },
      })
      .catch((err: unknown) => {
        req.log.warn({ err, keyId: key.id }, 'apikey.used audit-log write failed');
      });
  }

  return { orgId: key.orgId, keyId: key.id, scopes: key.scopes };
}
