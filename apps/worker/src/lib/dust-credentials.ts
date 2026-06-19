// Per-org Dust client resolution for the worker. The security-critical decrypt/
// merge/precedence logic lives once in '@bidstack/shared/server'; this is the
// thin org-scoped DB query + DustClient construction.

import type pino from 'pino';
import { prisma } from '@bidstack/db';
import { DustClient, type DustAgent, type DustAgentRun, type DustDocument, type DustDocumentDetail } from '@bidstack/dust-client';
import {
  SERUM_RUNTIME_CONFIG_KEYS,
  checkSerumDustMcpGatewayRuntimePolicy,
} from '@bidstack/db/serum-runtime-policy';
import {
  dustCredentialsFromConfigRow,
  dustCredentialsFromEnv,
  type DustCredentials,
} from '@bidstack/shared/server';
import type { SerumConfigEnvironment } from '@bidstack/shared';

export { resolveAgentId, maskApiKey, type DustCredentials } from '@bidstack/shared/server';

type DustRuntimeOptions = {
  environment?: SerumConfigEnvironment;
  writeApprovalConfirmed?: boolean;
  toolAuditPresent?: boolean;
};

function defaultSerumConfigEnvironment(): SerumConfigEnvironment {
  const env = process.env.SERUM_CONFIG_ENVIRONMENT;
  if (env === 'staging' || env === 'production') return env;
  return 'dev';
}

class SerumGuardedDustClient extends DustClient {
  private readonly orgId: string;
  private readonly environment: SerumConfigEnvironment;
  private readonly writeApprovalConfirmed: boolean;
  private readonly toolAuditPresent: boolean;
  private readonly gatewayLog: pino.Logger;

  constructor(
    opts: ConstructorParameters<typeof DustClient>[0] & {
      orgId: string;
      environment: SerumConfigEnvironment;
      writeApprovalConfirmed: boolean;
      toolAuditPresent: boolean;
      logger: pino.Logger;
    },
  ) {
    super(opts);
    this.orgId = opts.orgId;
    this.environment = opts.environment;
    this.writeApprovalConfirmed = opts.writeApprovalConfirmed;
    this.toolAuditPresent = opts.toolAuditPresent;
    this.gatewayLog = opts.logger;
  }

  private async guard(operation: string, writeRequested: boolean): Promise<void> {
    const decision = await checkSerumDustMcpGatewayRuntimePolicy({
      orgId: this.orgId,
      environment: this.environment,
      configKey: SERUM_RUNTIME_CONFIG_KEYS.dustMcpGateway,
      operation,
      writeRequested,
      approvalConfirmed: this.writeApprovalConfirmed,
      toolAuditPresent: this.toolAuditPresent,
    });
    if (!decision.allowed) {
      this.gatewayLog.warn({ operation, reason: decision.reason }, 'dust: SERUM gateway denied operation');
      throw new Error(`SERUM Dust/MCP Gateway denied ${operation}: ${decision.reason}`);
    }
  }

  override async listDocuments(dataSourceId: string): Promise<DustDocument[]> {
    await this.guard('dust.listDocuments', false);
    return super.listDocuments(dataSourceId);
  }

  override async getDocument(dataSourceId: string, documentId: string): Promise<DustDocumentDetail> {
    await this.guard('dust.getDocument', false);
    return super.getDocument(dataSourceId, documentId);
  }

  override async listAgents(
    view: 'all' | 'list' | 'published' | 'global' | 'favorites' = 'list',
  ): Promise<DustAgent[]> {
    await this.guard('dust.listAgents', false);
    return super.listAgents(view);
  }

  override async upsertDocument(
    dataSourceId: string,
    documentId: string,
    text: string,
    metadata: Record<string, unknown> = {},
  ): Promise<DustDocument> {
    await this.guard('dust.upsertDocument', true);
    return super.upsertDocument(dataSourceId, documentId, text, metadata);
  }

  override async runAgent(
    agentId: string,
    message: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<DustAgentRun> {
    await this.guard('dust.runAgent', false);
    return super.runAgent(agentId, message, opts);
  }

  override async getConversation(conversationId: string): Promise<Record<string, unknown>> {
    await this.guard('dust.getConversation', false);
    return super.getConversation(conversationId);
  }
}

/**
 * Resolve an org's Dust credentials: the per-org IntegrationConfig
 * (type='dust', name='dust') first, then the global DUST_* env fallback. null
 * when neither is configured.
 *
 * WHY raw SQL: the 'dust' IntegrationType value isn't in the generated Prisma
 * client until it's regenerated (Linux/Azure regenerates cleanly; the dev
 * Windows DLL lock blocks it). Parameterized + org-scoped.
 */
export async function resolveOrgDustCredentials(orgId: string): Promise<DustCredentials | null> {
  const rows = await prisma.$queryRaw<{ config: unknown; credentials: unknown }[]>`
    SELECT config, credentials FROM integration_configs
    WHERE org_id = ${orgId}::uuid AND type::text = 'dust' AND name = 'dust'
      AND is_active = true AND deleted_at IS NULL
    LIMIT 1
  `;
  return dustCredentialsFromConfigRow(rows[0] ?? null) ?? dustCredentialsFromEnv(process.env);
}

/**
 * Resolve the org's credentials AND a ready Dust client in a single lookup.
 * Workers need both — the client to run agents and the creds to resolve
 * purpose-specific agent ids (resolveAgentId). client/creds are null together
 * when nothing is configured (fail-open: the caller writes a placeholder).
 */
export async function getOrgDust(
  orgId: string,
  log: pino.Logger,
  runtime: DustRuntimeOptions = {},
): Promise<{ client: DustClient | null; creds: DustCredentials | null }> {
  const creds = await resolveOrgDustCredentials(orgId);
  if (!creds) return { client: null, creds: null };
  return {
    client: new SerumGuardedDustClient({
      apiKey: creds.apiKey,
      workspaceId: creds.workspaceId,
      baseUrl: creds.baseUrl,
      logger: log,
      orgId,
      environment: runtime.environment ?? defaultSerumConfigEnvironment(),
      writeApprovalConfirmed: runtime.writeApprovalConfirmed ?? false,
      toolAuditPresent: runtime.toolAuditPresent ?? true,
    }),
    creds,
  };
}

/** A Dust client bound to the org's credentials, or null when none are configured. */
export async function getOrgDustClient(
  orgId: string,
  log: pino.Logger,
): Promise<DustClient | null> {
  const { client } = await getOrgDust(orgId, log);
  if (!client) log.warn({ orgId }, 'dust: no per-org or global credentials configured');
  return client;
}
