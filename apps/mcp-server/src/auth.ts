// Per-key authentication for MCP tool calls.
// Resolves Bearer token -> ApiKey row -> AuthCtx { orgId, scopes, keyId }.
// Updates lastUsedAt on every call.

import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@bidstack/db';

export interface McpAuthCtx {
  orgId: string;
  keyId: string;
  scopes: string[];
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

  return { orgId: key.orgId, keyId: key.id, scopes: key.scopes };
}
