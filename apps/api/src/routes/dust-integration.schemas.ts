/**
 * dust-integration.schemas.ts — Zod schemas and derived types for the Dust
 * integration routes.
 *
 * Extracted from dust-integration.helpers.ts (BS-R1 file-size refactor).
 * Re-exported from dust-integration.helpers.ts — callers continue to import
 * from that file unchanged.
 */
import { z } from 'zod';

export const DustStatus = z.object({
  workspace: z.string(),
  lastSyncAt: z.string().datetime().nullable(),
  nextSyncAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  pulled24h: z.number().int(),
  pushed24h: z.number().int(),
  configured: z.boolean(),
  agentsError: z.string().nullable(),
  agents: z.array(
    z.object({ id: z.string(), label: z.string(), description: z.string().nullable() }),
  ),
});
export type DustStatusPayload = z.infer<typeof DustStatus>;

export type DustStatusCacheEntry = {
  expiresAt: number;
  promise: Promise<DustStatusPayload>;
};

export const ApiKeySummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const IntegrationSetupGuide = z.object({
  generatedAt: z.string().datetime(),
  dust: z.object({
    configured: z.boolean(),
    workspaceId: z.string().nullable(),
    dataSourceConfigured: z.boolean(),
    webhookReceiverUrl: z.string(),
  }),
  mcp: z.object({
    publicUrl: z.string(),
    healthUrl: z.string(),
    wellKnownUrl: z.string(),
    transport: z.literal('streamable-http'),
    configured: z.boolean(),
    readScopes: z.array(z.string()),
    writeScopes: z.array(z.string()),
  }),
  rest: z.object({
    baseUrl: z.string(),
    authHeader: z.literal('x-api-key: <BIDSTACK_API_KEY>'),
    recommendedScopes: z.array(z.string()),
  }),
  webhooks: z.object({
    subscriptionsUrl: z.string(),
    receiverUrl: z.string(),
    requiredHeaders: z.array(z.string()),
    recommendedEvents: z.array(z.string()),
  }),
  snippets: z.object({
    dustMcpToolConfig: z.string(),
    mcpHealthCheck: z.string(),
    restOpportunitySearch: z.string(),
    webhookReceiver: z.string(),
  }),
});

export const IntegrationProbeBody = z.object({
  kind: z.enum(['mcp', 'rest', 'webhook']),
  url: z.string().url().max(500),
});

export const IntegrationProbeResult = z.object({
  ok: z.boolean(),
  status: z.number().int().nullable(),
  latencyMs: z.number().int().nonnegative(),
  checkedUrl: z.string(),
  message: z.string(),
  warnings: z.array(z.string()),
});
