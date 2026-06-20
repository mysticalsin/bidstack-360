import { decryptSecret } from '@bidstack/shared/server-crypto';
import {
  AGENT_PROVIDER_ACTIVE_NAME,
  AGENT_PROVIDER_CONFIG_TYPE,
  AGENT_PROVIDER_CREDENTIAL_PREFIX,
  agentProviderCredentialName,
  isDirectAgentProvider,
  type DirectAgentProviderId,
} from '@bidstack/shared/llm';
import {
  SerumRuntimeDecision,
  SerumRuntimePolicy,
  type SerumConfigEnvironment as SerumConfigEnvironmentValue,
  type SerumConfigType as SerumConfigTypeValue,
  type SerumRuntimeAgentPolicy as SerumRuntimeAgentPolicyDto,
  type SerumRuntimeConnectorPolicy as SerumRuntimeConnectorPolicyDto,
  type SerumRuntimeDecision as SerumRuntimeDecisionDto,
  type SerumRuntimeDustMcpGatewayPolicy as SerumRuntimeDustMcpGatewayPolicyDto,
  type SerumRuntimeEvalsQualityGatePolicy as SerumRuntimeEvalsQualityGatePolicyDto,
  type SerumRuntimeModelRouterPolicy as SerumRuntimeModelRouterPolicyDto,
  type SerumRuntimeLoopPolicy as SerumRuntimeLoopPolicyDto,
  type SerumRuntimePolicy as SerumRuntimePolicyDto,
  type SerumRuntimePromptLibraryPolicy as SerumRuntimePromptLibraryPolicyDto,
  type SerumRuntimeRetrievalPolicy as SerumRuntimeRetrievalPolicyDto,
  type SerumRuntimeToolPolicy as SerumRuntimeToolPolicyDto,
} from '@bidstack/shared';

import { Prisma } from '../generated/client/index.js';
import { prisma } from './index.js';

export const SERUM_RUNTIME_CONFIG_KEYS = {
  agents: 'registry',
  loops: 'orchestration',
  tools: 'registry',
  connectors: 'registry',
  modelRouter: 'routing',
  dustMcpGateway: 'gateway',
  retrieval: 'policy',
  promptLibrary: 'governance',
  evalsQualityGates: 'release',
} as const;

type RuntimeConfigKeys = {
  agents: string;
  loops: string;
  tools: string;
  connectors: string;
  modelRouter: string;
  dustMcpGateway: string;
  retrieval: string;
  promptLibrary: string;
  evalsQualityGates: string;
};

type ActiveConfigRow = {
  id: string;
  configType: string;
  configKey: string;
  version: number;
  configJson: unknown;
};

type ToolScope = 'read' | 'write';
type DirectAgentProvider = DirectAgentProviderId;

type ModelRouterRuntimePolicy = Omit<SerumRuntimeModelRouterPolicyDto, 'providerConfigured'>;

type AgentProviderCredentialRow = {
  name: string;
  config: unknown;
  credentials: unknown;
  updatedAt: Date;
};

type OrgAgentProviderCredential = {
  provider: DirectAgentProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  updatedAt: Date;
  source: 'org';
};

const ACTIVE_CREW_RUN_STATUSES = ['queued', 'running', 'active'];
const CONNECTOR_CONNECTION_TEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MCP_TOOL_SCOPES: Record<string, ToolScope> = {
  'opportunities.list': 'read',
  'opportunities.get': 'read',
  'opportunity.update': 'write',
  'contacts.list': 'read',
  'contacts.get': 'read',
  'contacts.create': 'write',
  'tasks.create': 'write',
  'tasks.list': 'read',
  'tasks.update': 'write',
  'proposal.draft': 'read',
  spotlight_ref: 'read',
  'leads.list': 'read',
  'leads.get': 'read',
  'leads.create': 'write',
  'leads.update': 'write',
  'leads.convert': 'write',
  'notes.list': 'read',
  'notes.create': 'write',
  crm_search_companies: 'read',
  crm_create_deal: 'write',
  crm_update_deal: 'write',
  crm_enrich_company: 'write',
  crm_list_activities: 'read',
  crm_create_activity: 'write',
  crm_generate_insights: 'read',
};

function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boolConfig(config: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof config[key] === 'boolean' ? config[key] : fallback;
}

function numberConfig(config: Record<string, unknown>, key: string, fallback: number): number {
  return typeof config[key] === 'number' && Number.isFinite(config[key])
    ? Math.trunc(config[key])
    : fallback;
}

function stringConfig(config: Record<string, unknown>, key: string, fallback = ''): string {
  return typeof config[key] === 'string' ? config[key].trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function nullableStringConfig(config: Record<string, unknown>, key: string): string | null {
  const value = stringConfig(config, key);
  return value.length > 0 ? value : null;
}

function stringArrayConfig(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toCount(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}

function inputJsonObject(value: Record<string, unknown> | undefined): Prisma.InputJsonObject {
  return (value ?? {}) as Prisma.InputJsonObject;
}

function normalizeConnectorId(connectorId: string): string {
  return connectorId.trim().toLowerCase();
}

export async function recordSerumConnectorConnectionTest(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  connectorId: string;
  operation: string;
  testedByUserId?: string | null;
  evidence?: Record<string, unknown>;
  ttlMs?: number;
}): Promise<void> {
  const testedAt = new Date();
  const ttlMs =
    typeof args.ttlMs === 'number' && Number.isFinite(args.ttlMs) && args.ttlMs > 0
      ? Math.trunc(args.ttlMs)
      : CONNECTOR_CONNECTION_TEST_TTL_MS;
  await prisma.serumConnectorConnectionTest.create({
    data: {
      orgId: args.orgId,
      environment: args.environment,
      connectorId: normalizeConnectorId(args.connectorId),
      operation: args.operation.trim(),
      status: 'success',
      testedByUserId: args.testedByUserId ?? null,
      testedAt,
      expiresAt: new Date(testedAt.getTime() + ttlMs),
      evidence: inputJsonObject(args.evidence),
    },
  });
}

async function hasFreshSerumConnectorConnectionTest(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  connectorId: string;
  checkedAt?: Date;
}): Promise<boolean> {
  const checkedAt = args.checkedAt ?? new Date();
  const evidence = await prisma.serumConnectorConnectionTest.findFirst({
    where: {
      orgId: args.orgId,
      environment: args.environment,
      connectorId: normalizeConnectorId(args.connectorId),
      status: 'success',
      expiresAt: { gt: checkedAt },
    },
    select: { id: true },
    orderBy: { testedAt: 'desc' },
  });
  return Boolean(evidence);
}

function providerFromCredentialName(name: string): DirectAgentProvider | null {
  if (!name.startsWith(AGENT_PROVIDER_CREDENTIAL_PREFIX)) return null;
  const provider = name.slice(AGENT_PROVIDER_CREDENTIAL_PREFIX.length);
  return isDirectAgentProvider(provider) ? provider : null;
}

function credentialFromRow(row: AgentProviderCredentialRow): OrgAgentProviderCredential | null {
  const provider = providerFromCredentialName(row.name);
  if (!provider) return null;

  const config = asJsonObject(row.config);
  const credentials = asJsonObject(row.credentials);
  const encrypted = optionalString(credentials.encrypted);
  let apiKey: string | undefined;

  if (encrypted) {
    try {
      const parsed = JSON.parse(decryptSecret(encrypted)) as { apiKey?: unknown };
      apiKey = optionalString(parsed.apiKey);
    } catch {
      return null;
    }
  }

  if (provider !== 'gemma' && !apiKey) return null;

  return {
    provider,
    apiKey,
    model: optionalString(config.model),
    baseUrl: optionalString(config.baseUrl),
    updatedAt: row.updatedAt,
    source: 'org',
  };
}

async function resolveOrgAgentProviderCredential(
  orgId: string,
  provider: DirectAgentProvider,
): Promise<OrgAgentProviderCredential | null> {
  const rows = await prisma.$queryRaw<AgentProviderCredentialRow[]>`
    SELECT name, config, credentials, updated_at AS "updatedAt"
    FROM integration_configs
    WHERE org_id = ${orgId}::uuid
      AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
      AND name = ${agentProviderCredentialName(provider)}
      AND is_active = true
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ? credentialFromRow(rows[0]) : null;
}

async function getOrgActiveAgentProvider(orgId: string): Promise<DirectAgentProvider | null> {
  const rows = await prisma.$queryRaw<{ config: unknown }[]>`
    SELECT config
    FROM integration_configs
    WHERE org_id = ${orgId}::uuid
      AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
      AND name = ${AGENT_PROVIDER_ACTIVE_NAME}
      AND is_active = true
      AND deleted_at IS NULL
    LIMIT 1
  `;
  const provider = optionalString(asJsonObject(rows[0]?.config).provider);
  return provider && isDirectAgentProvider(provider) ? provider : null;
}

async function readActiveConfig(args: {
  orgId: string;
  configType: SerumConfigTypeValue;
  configKey: string;
  environment: SerumConfigEnvironmentValue;
}): Promise<ActiveConfigRow | null> {
  return prisma.serumConfigVersion.findFirst({
    where: {
      orgId: args.orgId,
      configType: args.configType,
      configKey: args.configKey,
      environment: args.environment,
      status: 'active',
      deletedAt: null,
    },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      configType: true,
      configKey: true,
      version: true,
      configJson: true,
    },
  });
}

async function countActiveCrewRuns(orgId: string, excludedRunId?: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint | string }>>`
    SELECT COUNT(*)::int AS count
    FROM crew_runs
    WHERE org_id = ${orgId}::uuid
      AND status IN (${Prisma.join(ACTIVE_CREW_RUN_STATUSES)})
      AND completed_at IS NULL
      AND (${excludedRunId ?? null}::uuid IS NULL OR id <> ${excludedRunId ?? null}::uuid)
  `;
  return toCount(rows[0]?.count);
}

function runtimeDecision(args: {
  configType: SerumConfigTypeValue;
  configKey: string;
  environment: SerumConfigEnvironmentValue;
  subject: string;
  allowed: boolean;
  status: SerumRuntimeDecisionDto['status'];
  reason: string;
  activeConfigVersionId: string | null;
}): SerumRuntimeDecisionDto {
  return SerumRuntimeDecision.parse(args);
}

function buildAgentPolicy(row: ActiveConfigRow | null, currentActiveRuns: number): SerumRuntimeAgentPolicyDto {
  const config = asJsonObject(row?.configJson);
  return {
    activeConfigVersionId: row?.id ?? null,
    activeConfigVersion: row?.version ?? null,
    enabled: row ? boolConfig(config, 'enabled', false) : false,
    autonomy: stringConfig(config, 'autonomy', 'disabled'),
    allowedAgentIds: stringArrayConfig(config, 'allowedAgentIds'),
    maxConcurrentRuns: Math.max(0, numberConfig(config, 'maxConcurrentRuns', 0)),
    currentActiveRuns,
    humanApprovalRequired: boolConfig(config, 'humanApprovalRequired', true),
  };
}

function buildLoopPolicy(row: ActiveConfigRow | null): SerumRuntimeLoopPolicyDto {
  const config = asJsonObject(row?.configJson);
  return {
    activeConfigVersionId: row?.id ?? null,
    activeConfigVersion: row?.version ?? null,
    enabled: row ? boolConfig(config, 'enabled', false) : false,
    durableEventsRequired: boolConfig(config, 'durableEventsRequired', true),
    stopOnApprovalGate: boolConfig(config, 'stopOnApprovalGate', true),
    replayMode: stringConfig(config, 'replayMode', 'manual_only'),
    maxRetries: Math.max(0, numberConfig(config, 'maxRetries', 0)),
  };
}

function buildToolPolicy(row: ActiveConfigRow | null): SerumRuntimeToolPolicyDto {
  const config = asJsonObject(row?.configJson);
  return {
    activeConfigVersionId: row?.id ?? null,
    activeConfigVersion: row?.version ?? null,
    enabled: row ? boolConfig(config, 'enabled', false) : false,
    registryMode: stringConfig(config, 'registryMode', 'explicit_allowlist'),
    allowedTools: stringArrayConfig(config, 'allowedTools'),
    allowWriteTools: boolConfig(config, 'allowWriteTools', false),
    requireDryRunForWriteTools: boolConfig(config, 'requireDryRunForWriteTools', true),
  };
}

function buildConnectorPolicy(row: ActiveConfigRow | null): SerumRuntimeConnectorPolicyDto {
  const config = asJsonObject(row?.configJson);
  return {
    activeConfigVersionId: row?.id ?? null,
    activeConfigVersion: row?.version ?? null,
    enabled: row ? boolConfig(config, 'enabled', false) : false,
    connectorMode: stringConfig(config, 'connectorMode', 'read_only'),
    requireConnectionTest: boolConfig(config, 'requireConnectionTest', true),
    secretRefs: stringArrayConfig(config, 'secretRefs'),
  };
}

function buildDustMcpGatewayPolicy(row: ActiveConfigRow | null): SerumRuntimeDustMcpGatewayPolicyDto {
  const config = asJsonObject(row?.configJson);
  return {
    activeConfigVersionId: row?.id ?? null,
    activeConfigVersion: row?.version ?? null,
    dustEnabled: row ? boolConfig(config, 'dustEnabled', false) : false,
    mcpEnabled: row ? boolConfig(config, 'mcpEnabled', false) : false,
    writeMode: stringConfig(config, 'writeMode', 'disabled'),
    secretRefs: stringArrayConfig(config, 'secretRefs'),
    requireToolAudit: boolConfig(config, 'requireToolAudit', true),
  };
}

function buildRetrievalPolicy(row: ActiveConfigRow | null): SerumRuntimeRetrievalPolicyDto {
  const config = asJsonObject(row?.configJson);
  const rawMinimumConfidence = config.minimumConfidence;
  const minimumConfidence =
    typeof rawMinimumConfidence === 'number' && Number.isFinite(rawMinimumConfidence)
      ? Math.max(0, Math.min(1, rawMinimumConfidence))
      : 0.72;
  return {
    activeConfigVersionId: row?.id ?? null,
    activeConfigVersion: row?.version ?? null,
    enabled: row ? boolConfig(config, 'enabled', false) : false,
    requireGroundedSources: boolConfig(config, 'requireGroundedSources', true),
    minimumConfidence,
    maxChunks: Math.max(1, numberConfig(config, 'maxChunks', 8)),
    noSourceBehavior: stringConfig(config, 'noSourceBehavior', 'say_uncertain'),
  };
}

function buildPromptLibraryPolicy(row: ActiveConfigRow | null): SerumRuntimePromptLibraryPolicyDto {
  const config = asJsonObject(row?.configJson);
  return {
    activeConfigVersionId: row?.id ?? null,
    activeConfigVersion: row?.version ?? null,
    versionedPromptsRequired: boolConfig(config, 'versionedPromptsRequired', true),
    promptInjectionTestsRequired: boolConfig(config, 'promptInjectionTestsRequired', true),
    approvalRequiredForProduction: boolConfig(config, 'approvalRequiredForProduction', true),
    allowedPromptSets: stringArrayConfig(config, 'allowedPromptSets'),
  };
}

function buildEvalsQualityGatePolicy(
  row: ActiveConfigRow | null,
): SerumRuntimeEvalsQualityGatePolicyDto {
  const config = asJsonObject(row?.configJson);
  const rawMinimumPassRate = config.minimumPassRate;
  const minimumPassRate =
    typeof rawMinimumPassRate === 'number' && Number.isFinite(rawMinimumPassRate)
      ? Math.max(0, Math.min(1, rawMinimumPassRate))
      : 0.98;
  return {
    activeConfigVersionId: row?.id ?? null,
    activeConfigVersion: row?.version ?? null,
    requiredBeforePublish: boolConfig(config, 'requiredBeforePublish', true),
    minimumPassRate,
    regressionSuites: stringArrayConfig(config, 'regressionSuites'),
    blockOnFailure: boolConfig(config, 'blockOnFailure', true),
  };
}

async function providerHasRuntimeCredentials(
  orgId: string,
  provider: string | null,
): Promise<boolean> {
  if (!provider || provider === 'not_configured') return false;
  if (!isDirectAgentProvider(provider)) return false;
  if (provider === 'gemma') return true;
  return Boolean(await resolveOrgAgentProviderCredential(orgId, provider));
}

async function buildModelRouterPolicy(
  orgId: string,
  row: ActiveConfigRow | null,
): Promise<SerumRuntimeModelRouterPolicyDto> {
  const config = asJsonObject(row?.configJson);
  const defaultProvider = nullableStringConfig(config, 'defaultProvider');
  const fallbackProvider = nullableStringConfig(config, 'fallbackProvider');
  const activeProvider = await getOrgActiveAgentProvider(orgId);
  const configuredCandidates = [activeProvider, defaultProvider, fallbackProvider].filter(
    (provider): provider is DirectAgentProvider =>
      Boolean(provider && provider !== 'not_configured' && isDirectAgentProvider(provider)),
  );
  const effectiveProvider = configuredCandidates[0] ?? null;

  return {
    activeConfigVersionId: row?.id ?? null,
    activeConfigVersion: row?.version ?? null,
    defaultProvider: defaultProvider === 'not_configured' ? null : defaultProvider,
    fallbackProvider: fallbackProvider === 'not_configured' ? null : fallbackProvider,
    effectiveProvider,
    providerConfigured: await providerHasRuntimeCredentials(orgId, effectiveProvider),
    maxTokensPerRequest: Math.max(1, numberConfig(config, 'maxTokensPerRequest', 4000)),
    requireSourceCitations: boolConfig(config, 'requireSourceCitations', true),
    uncertaintyMode: stringConfig(config, 'uncertaintyMode', 'answer_with_limits'),
  };
}

function buildModelRouterRuntimePolicy(row: ActiveConfigRow | null): ModelRouterRuntimePolicy {
  const config = asJsonObject(row?.configJson);
  const defaultProvider = nullableStringConfig(config, 'defaultProvider');
  const fallbackProvider = nullableStringConfig(config, 'fallbackProvider');
  const defaultPolicyProvider =
    defaultProvider && defaultProvider !== 'not_configured' && isDirectAgentProvider(defaultProvider)
      ? defaultProvider
      : null;
  const fallbackPolicyProvider =
    fallbackProvider && fallbackProvider !== 'not_configured' && isDirectAgentProvider(fallbackProvider)
      ? fallbackProvider
      : null;

  return {
    activeConfigVersionId: row?.id ?? null,
    activeConfigVersion: row?.version ?? null,
    defaultProvider: defaultProvider === 'not_configured' ? null : defaultProvider,
    fallbackProvider: fallbackProvider === 'not_configured' ? null : fallbackProvider,
    effectiveProvider: defaultPolicyProvider ?? fallbackPolicyProvider,
    maxTokensPerRequest: Math.max(1, numberConfig(config, 'maxTokensPerRequest', 4000)),
    requireSourceCitations: boolConfig(config, 'requireSourceCitations', true),
    uncertaintyMode: stringConfig(config, 'uncertaintyMode', 'answer_with_limits'),
  };
}

export async function resolveSerumRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKeys?: Partial<RuntimeConfigKeys>;
  excludedRunId?: string;
}): Promise<SerumRuntimePolicyDto> {
  const configKeys = { ...SERUM_RUNTIME_CONFIG_KEYS, ...args.configKeys };
  const [
    agentsConfig,
    loopsConfig,
    toolsConfig,
    connectorsConfig,
    modelRouterConfig,
    dustMcpGatewayConfig,
    retrievalConfig,
    promptLibraryConfig,
    evalsQualityGatesConfig,
    currentActiveRuns,
  ] =
    await Promise.all([
      readActiveConfig({
        orgId: args.orgId,
        configType: 'agents',
        configKey: configKeys.agents,
        environment: args.environment,
      }),
      readActiveConfig({
        orgId: args.orgId,
        configType: 'loops',
        configKey: configKeys.loops,
        environment: args.environment,
      }),
      readActiveConfig({
        orgId: args.orgId,
        configType: 'tools',
        configKey: configKeys.tools,
        environment: args.environment,
      }),
      readActiveConfig({
        orgId: args.orgId,
        configType: 'connectors',
        configKey: configKeys.connectors,
        environment: args.environment,
      }),
      readActiveConfig({
        orgId: args.orgId,
        configType: 'model_router',
        configKey: configKeys.modelRouter,
        environment: args.environment,
      }),
      readActiveConfig({
        orgId: args.orgId,
        configType: 'dust_mcp_gateway',
        configKey: configKeys.dustMcpGateway,
        environment: args.environment,
      }),
      readActiveConfig({
        orgId: args.orgId,
        configType: 'retrieval',
        configKey: configKeys.retrieval,
        environment: args.environment,
      }),
      readActiveConfig({
        orgId: args.orgId,
        configType: 'prompt_library',
        configKey: configKeys.promptLibrary,
        environment: args.environment,
      }),
      readActiveConfig({
        orgId: args.orgId,
        configType: 'evals_quality_gates',
        configKey: configKeys.evalsQualityGates,
        environment: args.environment,
      }),
      countActiveCrewRuns(args.orgId, args.excludedRunId),
    ]);

  return SerumRuntimePolicy.parse({
    generatedAt: new Date().toISOString(),
    environment: args.environment,
    agents: buildAgentPolicy(agentsConfig, currentActiveRuns),
    loops: buildLoopPolicy(loopsConfig),
    tools: buildToolPolicy(toolsConfig),
    connectors: buildConnectorPolicy(connectorsConfig),
    modelRouter: await buildModelRouterPolicy(args.orgId, modelRouterConfig),
    dustMcpGateway: buildDustMcpGatewayPolicy(dustMcpGatewayConfig),
    retrieval: buildRetrievalPolicy(retrievalConfig),
    promptLibrary: buildPromptLibraryPolicy(promptLibraryConfig),
    evalsQualityGates: buildEvalsQualityGatePolicy(evalsQualityGatesConfig),
  });
}

async function resolveAgentRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
  excludedRunId?: string;
}): Promise<SerumRuntimeAgentPolicyDto> {
  const [row, currentActiveRuns] = await Promise.all([
    readActiveConfig({
      orgId: args.orgId,
      configType: 'agents',
      configKey: args.configKey,
      environment: args.environment,
    }),
    countActiveCrewRuns(args.orgId, args.excludedRunId),
  ]);
  return buildAgentPolicy(row, currentActiveRuns);
}

async function resolveLoopRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
}): Promise<SerumRuntimeLoopPolicyDto> {
  const row = await readActiveConfig({
    orgId: args.orgId,
    configType: 'loops',
    configKey: args.configKey,
    environment: args.environment,
  });
  return buildLoopPolicy(row);
}

async function resolveToolRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
}): Promise<SerumRuntimeToolPolicyDto> {
  const row = await readActiveConfig({
    orgId: args.orgId,
    configType: 'tools',
    configKey: args.configKey,
    environment: args.environment,
  });
  return buildToolPolicy(row);
}

async function resolveConnectorRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
}): Promise<SerumRuntimeConnectorPolicyDto> {
  const row = await readActiveConfig({
    orgId: args.orgId,
    configType: 'connectors',
    configKey: args.configKey,
    environment: args.environment,
  });
  return buildConnectorPolicy(row);
}

async function resolveModelRouterRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
}): Promise<ModelRouterRuntimePolicy> {
  const row = await readActiveConfig({
    orgId: args.orgId,
    configType: 'model_router',
    configKey: args.configKey,
    environment: args.environment,
  });
  return buildModelRouterRuntimePolicy(row);
}

async function resolveDustMcpGatewayRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
}): Promise<SerumRuntimeDustMcpGatewayPolicyDto> {
  const row = await readActiveConfig({
    orgId: args.orgId,
    configType: 'dust_mcp_gateway',
    configKey: args.configKey,
    environment: args.environment,
  });
  return buildDustMcpGatewayPolicy(row);
}

async function resolveRetrievalRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
}): Promise<SerumRuntimeRetrievalPolicyDto> {
  const row = await readActiveConfig({
    orgId: args.orgId,
    configType: 'retrieval',
    configKey: args.configKey,
    environment: args.environment,
  });
  return buildRetrievalPolicy(row);
}

async function resolvePromptLibraryRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
}): Promise<SerumRuntimePromptLibraryPolicyDto> {
  const row = await readActiveConfig({
    orgId: args.orgId,
    configType: 'prompt_library',
    configKey: args.configKey,
    environment: args.environment,
  });
  return buildPromptLibraryPolicy(row);
}

async function resolveEvalsQualityGateRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
}): Promise<SerumRuntimeEvalsQualityGatePolicyDto> {
  const row = await readActiveConfig({
    orgId: args.orgId,
    configType: 'evals_quality_gates',
    configKey: args.configKey,
    environment: args.environment,
  });
  return buildEvalsQualityGatePolicy(row);
}

export async function checkSerumAgentRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
  agentId: string;
  approvalConfirmed: boolean;
  excludedRunId?: string;
}): Promise<SerumRuntimeDecisionDto> {
  const agent = await resolveAgentRuntimePolicy({
    orgId: args.orgId,
    environment: args.environment,
    configKey: args.configKey,
    excludedRunId: args.excludedRunId,
  });
  const base = {
    configType: 'agents' as const,
    configKey: args.configKey,
    environment: args.environment,
    subject: args.agentId,
    activeConfigVersionId: agent.activeConfigVersionId,
  };

  if (!agent.activeConfigVersionId) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Agents policy is published.',
    });
  }
  if (!agent.enabled) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'disabled',
      reason: 'SERUM Agents policy is published but disabled.',
    });
  }
  if (!agent.humanApprovalRequired || !args.approvalConfirmed) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Human approval confirmation is required before an agent run can start.',
    });
  }
  if (/unrestricted|write|autonomous/i.test(agent.autonomy)) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Autonomous or write-capable agent modes are blocked by runtime policy.',
    });
  }
  if (!agent.allowedAgentIds.includes(args.agentId)) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Agent is not in the active SERUM allowlist.',
    });
  }
  if (agent.maxConcurrentRuns <= 0 || agent.currentActiveRuns >= agent.maxConcurrentRuns) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Agent concurrency cap is exhausted.',
    });
  }
  return runtimeDecision({
    ...base,
    allowed: true,
    status: 'allowed',
    reason: 'Agent run is allowed by the active SERUM policy.',
  });
}

export async function checkSerumLoopRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
  loopId: string;
  operation: string;
  retryCount: number;
  hasDurableEvent: boolean;
  approvalGateReached: boolean;
  replayRequested?: boolean;
  approvalConfirmed?: boolean;
}): Promise<SerumRuntimeDecisionDto> {
  const loops = await resolveLoopRuntimePolicy({
    orgId: args.orgId,
    environment: args.environment,
    configKey: args.configKey,
  });
  const loopId = args.loopId.trim();
  const operation = args.operation.trim();
  const subject = `${operation}:${loopId}`;
  const base = {
    configType: 'loops' as const,
    configKey: args.configKey,
    environment: args.environment,
    subject,
    activeConfigVersionId: loops.activeConfigVersionId,
  };

  if (!loops.activeConfigVersionId) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Loops policy is published.',
    });
  }
  if (!loops.enabled) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'disabled',
      reason: 'SERUM Loops policy is published but disabled.',
    });
  }
  if (loops.durableEventsRequired && !args.hasDurableEvent) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Loop execution requires durable event evidence.',
    });
  }
  if (loops.stopOnApprovalGate && args.approvalGateReached) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Loop execution must stop at the configured approval gate.',
    });
  }
  if (loops.maxRetries > 3) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Loop retry cap is outside the safe runtime range.',
    });
  }
  if (args.retryCount > loops.maxRetries) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Loop retry count exceeds the active SERUM retry cap.',
    });
  }
  if (/auto|continuous/i.test(loops.replayMode)) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Automatic loop replay is blocked by runtime policy.',
    });
  }
  if (args.replayRequested) {
    if (loops.replayMode === 'disabled') {
      return runtimeDecision({
        ...base,
        allowed: false,
        status: 'denied',
        reason: 'Loop replay is disabled by runtime policy.',
      });
    }
    if (loops.replayMode === 'approval_required' && !args.approvalConfirmed) {
      return runtimeDecision({
        ...base,
        allowed: false,
        status: 'denied',
        reason: 'Loop replay requires explicit approval confirmation.',
      });
    }
  }

  return runtimeDecision({
    ...base,
    allowed: true,
    status: 'allowed',
    reason: 'Loop execution is allowed by the active SERUM policy.',
  });
}

export async function checkSerumToolRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
  toolName: string;
  dryRun: boolean;
}): Promise<SerumRuntimeDecisionDto> {
  const tools = await resolveToolRuntimePolicy({
    orgId: args.orgId,
    environment: args.environment,
    configKey: args.configKey,
  });
  const base = {
    configType: 'tools' as const,
    configKey: args.configKey,
    environment: args.environment,
    subject: args.toolName,
    activeConfigVersionId: tools.activeConfigVersionId,
  };
  const scope = MCP_TOOL_SCOPES[args.toolName] ?? 'write';

  if (!tools.activeConfigVersionId) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Tools policy is published.',
    });
  }
  if (!tools.enabled) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'disabled',
      reason: 'SERUM Tools policy is published but disabled.',
    });
  }
  if (tools.registryMode !== 'explicit_allowlist') {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Tool registry must use explicit_allowlist mode.',
    });
  }
  if (!tools.allowedTools.includes(args.toolName)) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Tool is not in the active SERUM allowlist.',
    });
  }
  if (scope === 'write' && !tools.allowWriteTools) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Write tools are disabled by the active SERUM policy.',
    });
  }
  if (scope === 'write' && tools.requireDryRunForWriteTools && !args.dryRun) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Write tools require a dry-run check before execution.',
    });
  }
  return runtimeDecision({
    ...base,
    allowed: true,
    status: 'allowed',
    reason: 'Tool call is allowed by the active SERUM policy.',
  });
}

export async function checkSerumConnectorRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
  connectorId: string;
  operation: string;
  writeRequested: boolean;
  connectionTestProbe?: boolean;
  approvalConfirmed?: boolean;
}): Promise<SerumRuntimeDecisionDto> {
  const connectors = await resolveConnectorRuntimePolicy({
    orgId: args.orgId,
    environment: args.environment,
    configKey: args.configKey,
  });
  const connectorId = normalizeConnectorId(args.connectorId);
  const subject = `${args.operation.trim()}:${connectorId}`;
  const base = {
    configType: 'connectors' as const,
    configKey: args.configKey,
    environment: args.environment,
    subject,
    activeConfigVersionId: connectors.activeConfigVersionId,
  };

  if (!connectors.activeConfigVersionId) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Connectors policy is published.',
    });
  }
  if (!connectors.enabled) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'disabled',
      reason: 'SERUM Connectors policy is published but disabled.',
    });
  }
  if (connectors.secretRefs.length === 0) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Enabled connector policy requires secret references.',
    });
  }
  if (
    connectors.requireConnectionTest &&
    !args.connectionTestProbe &&
    !(await hasFreshSerumConnectorConnectionTest({
      orgId: args.orgId,
      environment: args.environment,
      connectorId,
    }))
  ) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Connector execution requires connection-test evidence.',
    });
  }

  const mode = connectors.connectorMode;
  if (mode === 'read_only' || mode === 'manual_sync') {
    if (args.writeRequested) {
      return runtimeDecision({
        ...base,
        allowed: false,
        status: 'denied',
        reason: 'Connector write operations are disabled by runtime policy.',
      });
    }
  } else if (mode === 'draft_write') {
    if (args.writeRequested) {
      return runtimeDecision({
        ...base,
        allowed: false,
        status: 'denied',
        reason: 'Draft-write connector mode blocks external writes at runtime.',
      });
    }
  } else if (mode === 'approved_write') {
    if (args.writeRequested && !args.approvalConfirmed) {
      return runtimeDecision({
        ...base,
        allowed: false,
        status: 'denied',
        reason: 'Connector write operations require explicit approval confirmation.',
      });
    }
  } else {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Connector mode is not safe for runtime use.',
    });
  }

  return runtimeDecision({
    ...base,
    allowed: true,
    status: 'allowed',
    reason: 'Connector operation is allowed by the active SERUM policy.',
  });
}

export async function checkSerumModelRouterRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
  provider?: string;
  requestedMaxTokens: number;
  sourceCitationsRequired: boolean;
}): Promise<SerumRuntimeDecisionDto> {
  const router = await resolveModelRouterRuntimePolicy({
    orgId: args.orgId,
    environment: args.environment,
    configKey: args.configKey,
  });
  const requestedProvider = args.provider ?? router.effectiveProvider;
  const allowedProviders = [router.defaultProvider, router.fallbackProvider].filter(Boolean);
  const base = {
    configType: 'model_router' as const,
    configKey: args.configKey,
    environment: args.environment,
    subject: requestedProvider ?? 'not_configured',
    activeConfigVersionId: router.activeConfigVersionId,
  };

  if (!router.activeConfigVersionId) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Model Router policy is published.',
    });
  }
  if (!requestedProvider || requestedProvider === 'not_configured') {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'not_configured',
      reason: 'No model provider is selected by the active SERUM policy.',
    });
  }
  if (!isDirectAgentProvider(requestedProvider)) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Requested provider is not a supported direct agent provider.',
    });
  }
  if (!allowedProviders.includes(requestedProvider)) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Requested provider is not allowed by the active SERUM router policy.',
    });
  }
  if (!(await providerHasRuntimeCredentials(args.orgId, requestedProvider))) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Requested provider has no usable runtime credentials.',
    });
  }
  if (router.requireSourceCitations && !args.sourceCitationsRequired) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Source citations are required by the active SERUM router policy.',
    });
  }
  if (args.requestedMaxTokens > router.maxTokensPerRequest) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Requested token budget exceeds the active SERUM router cap.',
    });
  }
  if (/answer_anyway|never_abstain/i.test(router.uncertaintyMode)) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Router uncertainty behavior is not safe for runtime use.',
    });
  }
  return runtimeDecision({
    ...base,
    allowed: true,
    status: 'allowed',
    reason: 'Model route is allowed by the active SERUM policy.',
  });
}

export async function checkSerumDustMcpGatewayRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
  operation: string;
  writeRequested: boolean;
  approvalConfirmed?: boolean;
  toolAuditPresent?: boolean;
}): Promise<SerumRuntimeDecisionDto> {
  const gateway = await resolveDustMcpGatewayRuntimePolicy({
    orgId: args.orgId,
    environment: args.environment,
    configKey: args.configKey,
  });
  const normalizedOperation = args.operation.trim();
  const operationKind = normalizedOperation.startsWith('mcp.') ? 'mcp' : 'dust';
  const inferredWriteRequested =
    args.writeRequested || /(upsert|create|update|delete|patch|push|write)/i.test(normalizedOperation);
  const base = {
    configType: 'dust_mcp_gateway' as const,
    configKey: args.configKey,
    environment: args.environment,
    subject: normalizedOperation,
    activeConfigVersionId: gateway.activeConfigVersionId,
  };

  if (!gateway.activeConfigVersionId) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Dust/MCP Gateway policy is published.',
    });
  }
  if (operationKind === 'dust' && !gateway.dustEnabled) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'disabled',
      reason: 'SERUM Dust/MCP Gateway policy is published but Dust is disabled.',
    });
  }
  if (operationKind === 'mcp' && !gateway.mcpEnabled) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'disabled',
      reason: 'SERUM Dust/MCP Gateway policy is published but MCP is disabled.',
    });
  }
  if (gateway.secretRefs.length === 0) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Enabled Dust/MCP Gateway policy requires secret references.',
    });
  }
  if (gateway.requireToolAudit && args.toolAuditPresent === false) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Dust/MCP Gateway operation requires a tool-audit trail.',
    });
  }
  if (inferredWriteRequested) {
    if (gateway.writeMode === 'disabled') {
      return runtimeDecision({
        ...base,
        allowed: false,
        status: 'denied',
        reason: 'Dust/MCP Gateway write operations are disabled by runtime policy.',
      });
    }
    if (gateway.writeMode === 'draft_only') {
      return runtimeDecision({
        ...base,
        allowed: false,
        status: 'denied',
        reason: 'Draft-only gateway mode blocks external Dust/MCP writes.',
      });
    }
    if (gateway.writeMode !== 'approval_required') {
      return runtimeDecision({
        ...base,
        allowed: false,
        status: 'denied',
        reason: 'Dust/MCP Gateway write mode is not safe for runtime use.',
      });
    }
    if (!args.approvalConfirmed) {
      return runtimeDecision({
        ...base,
        allowed: false,
        status: 'denied',
        reason: 'Gateway write operations require explicit approval confirmation.',
      });
    }
  }

  return runtimeDecision({
    ...base,
    allowed: true,
    status: 'allowed',
    reason: 'Dust/MCP Gateway operation is allowed by the active SERUM policy.',
  });
}

export async function checkSerumRetrievalRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
  operation: string;
  requestedChunks: number;
  sourceBacked: boolean;
  expectedConfidence: number;
}): Promise<SerumRuntimeDecisionDto> {
  const retrieval = await resolveRetrievalRuntimePolicy({
    orgId: args.orgId,
    environment: args.environment,
    configKey: args.configKey,
  });
  const subject = args.operation.trim();
  const base = {
    configType: 'retrieval' as const,
    configKey: args.configKey,
    environment: args.environment,
    subject,
    activeConfigVersionId: retrieval.activeConfigVersionId,
  };

  if (!retrieval.activeConfigVersionId) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Retrieval policy is published.',
    });
  }
  if (!retrieval.enabled) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'disabled',
      reason: 'SERUM Retrieval policy is published but disabled.',
    });
  }
  if (retrieval.requireGroundedSources && !args.sourceBacked) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Retrieval operations require grounded source evidence.',
    });
  }
  if (args.requestedChunks > retrieval.maxChunks) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Requested retrieval chunk count exceeds the active SERUM cap.',
    });
  }
  if (args.expectedConfidence < retrieval.minimumConfidence) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Expected retrieval confidence is below the active SERUM threshold.',
    });
  }
  if (/answer_anyway|ignore_sources|ungrounded/i.test(retrieval.noSourceBehavior)) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Retrieval no-source behavior is not safe for runtime use.',
    });
  }

  return runtimeDecision({
    ...base,
    allowed: true,
    status: 'allowed',
    reason: 'Retrieval operation is allowed by the active SERUM policy.',
  });
}

export async function checkSerumPromptLibraryRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
  operation: string;
  promptSet: string;
  versionedPrompt: boolean;
  injectionTested: boolean;
  productionApproved: boolean;
}): Promise<SerumRuntimeDecisionDto> {
  const promptLibrary = await resolvePromptLibraryRuntimePolicy({
    orgId: args.orgId,
    environment: args.environment,
    configKey: args.configKey,
  });
  const promptSet = args.promptSet.trim();
  const subject = `${args.operation.trim()}:${promptSet}`;
  const base = {
    configType: 'prompt_library' as const,
    configKey: args.configKey,
    environment: args.environment,
    subject,
    activeConfigVersionId: promptLibrary.activeConfigVersionId,
  };

  if (!promptLibrary.activeConfigVersionId) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Prompt Library policy is published.',
    });
  }
  if (promptLibrary.allowedPromptSets.length === 0) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Prompt Library policy must define an explicit allowedPromptSets list.',
    });
  }
  if (!promptLibrary.allowedPromptSets.includes(promptSet)) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Prompt set is not in the active SERUM allowlist.',
    });
  }
  if (promptLibrary.versionedPromptsRequired && !args.versionedPrompt) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Prompt Library policy requires versioned prompts before execution.',
    });
  }
  if (promptLibrary.promptInjectionTestsRequired && !args.injectionTested) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Prompt Library policy requires prompt-injection test coverage before execution.',
    });
  }
  if (
    args.environment === 'production' &&
    promptLibrary.approvalRequiredForProduction &&
    !args.productionApproved
  ) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Production prompt execution requires approved prompt release evidence.',
    });
  }

  return runtimeDecision({
    ...base,
    allowed: true,
    status: 'allowed',
    reason: 'Prompt execution is allowed by the active SERUM policy.',
  });
}

export async function checkSerumEvalsQualityGateRuntimePolicy(args: {
  orgId: string;
  environment: SerumConfigEnvironmentValue;
  configKey: string;
  operation: string;
  suite: string;
  passRate: number;
  failedCount: number;
}): Promise<SerumRuntimeDecisionDto> {
  const evals = await resolveEvalsQualityGateRuntimePolicy({
    orgId: args.orgId,
    environment: args.environment,
    configKey: args.configKey,
  });
  const suite = args.suite.trim();
  const subject = `${args.operation.trim()}:${suite}`;
  const base = {
    configType: 'evals_quality_gates' as const,
    configKey: args.configKey,
    environment: args.environment,
    subject,
    activeConfigVersionId: evals.activeConfigVersionId,
  };

  if (!evals.activeConfigVersionId) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Evals Quality Gates policy is published.',
    });
  }
  if (!evals.requiredBeforePublish) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'disabled',
      reason: 'SERUM eval gates are published but not required before publish.',
    });
  }
  if (evals.regressionSuites.length === 0) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Evals Quality Gates policy must define regressionSuites.',
    });
  }
  if (!evals.regressionSuites.includes(suite)) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Eval suite is not in the active SERUM regression allowlist.',
    });
  }
  if (!evals.blockOnFailure) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Evals Quality Gates policy must block release on failure.',
    });
  }
  if (args.failedCount > 0) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Eval suite has failing fixtures and blockOnFailure is enabled.',
    });
  }
  if (args.passRate < evals.minimumPassRate) {
    return runtimeDecision({
      ...base,
      allowed: false,
      status: 'denied',
      reason: 'Eval pass rate is below the active SERUM threshold.',
    });
  }

  return runtimeDecision({
    ...base,
    allowed: true,
    status: 'allowed',
    reason: 'Eval result is allowed by the active SERUM quality gate.',
  });
}
