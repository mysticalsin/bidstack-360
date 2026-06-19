import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { Prisma, prisma } from '@bidstack/db';
import {
  checkSerumAgentRuntimePolicy,
  checkSerumConnectorRuntimePolicy,
  checkSerumDustMcpGatewayRuntimePolicy,
  checkSerumEvalsQualityGateRuntimePolicy,
  checkSerumLoopRuntimePolicy,
  checkSerumModelRouterRuntimePolicy,
  checkSerumPromptLibraryRuntimePolicy,
  checkSerumRetrievalRuntimePolicy,
  checkSerumToolRuntimePolicy,
  resolveSerumRuntimePolicy,
} from '@bidstack/db/serum-runtime-policy';
import {
  SerumConfigAuditEntry,
  SerumConfigApprovalDecision,
  SerumConfigApprovalRequest,
  SerumConfigDraftUpsert,
  SerumConfigEnvironment,
  SerumConfigPublishRequest,
  SerumConfigRollbackRequest,
  SerumConfigSnapshot,
  SerumConfigTestRequest,
  SerumConfigTestResult,
  SerumConfigType,
  SerumConfigVersion,
  SerumRuntimeAgentCheckRequest,
  SerumRuntimeConnectorCheckRequest,
  SerumRuntimeDecision,
  SerumRuntimeDustMcpGatewayCheckRequest,
  SerumRuntimeEvalsQualityGateCheckRequest,
  SerumRuntimeLoopCheckRequest,
  SerumRuntimeModelRouterCheckRequest,
  SerumRuntimePolicy,
  SerumRuntimePromptLibraryCheckRequest,
  SerumRuntimeRetrievalCheckRequest,
  SerumRuntimeToolCheckRequest,
  SerumStatusSnapshot,
  type SerumConfigTestCheck as SerumConfigTestCheckDto,
  type SerumConfigTestResult as SerumConfigTestResultDto,
  type SerumBackendSignal,
  type SerumModuleStatus,
  type SerumProviderHealth,
  type SerumQueueHealth,
  type SerumSignalStatus,
  type SerumStatusCard,
} from '@bidstack/shared';

import { getEnv } from '../env.js';
import {
  getOrgActiveAgentProvider,
  listOrgAgentProviderCredentials,
} from '../lib/agent-provider-credentials.js';
import { resolveOrgDustCredentials } from '../lib/dust-credentials.js';

type ScalarSignal = number | bigint | string | Date | null | undefined;
type SignalTableAvailability = {
  crew_agents: boolean | null;
  crew_runs: boolean | null;
  rfp_orchestrations: boolean | null;
  document_versions: boolean | null;
  approval_gates: boolean | null;
  ai_invocations: boolean | null;
  audit_log: boolean | null;
  provider_health: boolean | null;
  queue_health: boolean | null;
};
type CoreSignalRow = {
  active_agents: ScalarSignal;
  active_crew_runs: ScalarSignal;
  active_rfp_runs: ScalarSignal;
  failed_rfp_runs: ScalarSignal;
  documents_processed_today: ScalarSignal;
  failed_documents_today: ScalarSignal;
  open_approvals: ScalarSignal;
  model_calls_today: ScalarSignal;
  model_tokens_today: ScalarSignal;
  latest_config_change_at: Date | null;
};
type ProviderHealthRow = {
  provider: string;
  status: string;
  latency_ms: number | null;
  last_checked_at: Date | null;
  message: string | null;
};
type QueueHealthRow = {
  queue_name: string;
  waiting: number;
  active: number;
  failed: number;
  completed: number;
  last_checked_at: Date | null;
};
type WarnLogger = { warn: (obj: unknown, msg?: string) => void };
type SerumConfigVersionDto = z.infer<typeof SerumConfigVersion>;
type SerumConfigAuditEntryDto = z.infer<typeof SerumConfigAuditEntry>;
type SerumConfigTypeValue = z.infer<typeof SerumConfigType>;
type SerumConfigEnvironmentValue = z.infer<typeof SerumConfigEnvironment>;

const emptyTableAvailability: SignalTableAvailability = {
  crew_agents: false,
  crew_runs: false,
  rfp_orchestrations: false,
  document_versions: false,
  approval_gates: false,
  ai_invocations: false,
  audit_log: false,
  provider_health: false,
  queue_health: false,
};

const emptyCoreSignals: CoreSignalRow = {
  active_agents: 0,
  active_crew_runs: 0,
  active_rfp_runs: 0,
  failed_rfp_runs: 0,
  documents_processed_today: 0,
  failed_documents_today: 0,
  open_approvals: 0,
  model_calls_today: 0,
  model_tokens_today: 0,
  latest_config_change_at: null,
};
const CONFIG_KEY_RE = /^[a-z0-9][a-z0-9_.:-]{0,119}$/;
const ConfigParams = z.object({
  configType: SerumConfigType,
  configKey: z.string().regex(CONFIG_KEY_RE),
});
const RuntimeConfigKeyParams = z.object({
  configKey: z.string().regex(CONFIG_KEY_RE),
});
const ConfigQuery = z.object({
  environment: SerumConfigEnvironment.optional(),
});
const ConfigIdParams = z.object({
  id: z.string().uuid(),
});
const SECRET_KEY_RE = /(api[_-]?key|password|private[_-]?key|credential|secret)$/i;
const ALLOWED_SECRET_REFERENCE_KEYS = new Set([
  'secretRef',
  'secretRefs',
  'secretReference',
  'secretReferences',
  'hasSecret',
  'secretConfigured',
]);
const HIGH_RISK_CONFIG_TYPES = new Set<SerumConfigTypeValue>([
  'agents',
  'loops',
  'model_router',
  'tools',
  'connectors',
  'prompt_library',
  'evals_quality_gates',
  'dust_mcp_gateway',
]);

function toInt(value: ScalarSignal): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value) || 0;
  return typeof value === 'number' ? value : 0;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function defaultConfigEnvironment(): SerumConfigEnvironmentValue {
  const env = process.env.SERUM_CONFIG_ENVIRONMENT;
  if (env === 'staging' || env === 'production') return env;
  return 'dev';
}

function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toInputJsonObject(value: unknown): Prisma.InputJsonObject {
  return asJsonObject(value) as Prisma.InputJsonObject;
}

function configRequiresApproval(configType: string): configType is SerumConfigTypeValue {
  return SerumConfigType.safeParse(configType).success &&
    HIGH_RISK_CONFIG_TYPES.has(configType as SerumConfigTypeValue);
}

function initialApprovalStatus(configType: string): 'not_required' | 'required' {
  return configRequiresApproval(configType) ? 'required' : 'not_required';
}

function approvalReferenceFor(row: {
  id: string;
  configType: string;
  configKey: string;
  environment: string;
  version: number;
}): string {
  const type = row.configType.replace(/[^a-z0-9]+/gi, '-').toUpperCase();
  const key = row.configKey.replace(/[^a-z0-9]+/gi, '-').toUpperCase().slice(0, 24);
  return `SERUM-${type}-${key}-${row.environment.toUpperCase()}-V${row.version}-${row.id.slice(0, 8).toUpperCase()}`;
}

function collectRawSecretMaterial(value: unknown, path: string[] = []): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectRawSecretMaterial(item, [...path, String(index)]));
  }

  const paths: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (SECRET_KEY_RE.test(key) && !ALLOWED_SECRET_REFERENCE_KEYS.has(key)) {
      paths.push(childPath.join('.'));
    }
    paths.push(...collectRawSecretMaterial(child, childPath));
  }
  return paths;
}

function assertNoRawSecretMaterial(value: unknown) {
  const paths = collectRawSecretMaterial(value);
  if (paths.length > 0) {
    throw new Error(
      `Raw secret material is not allowed in configJson at ${paths.join(', ')}. Store a secretRef instead.`,
    );
  }
}

function boolConfig(config: Record<string, unknown>, key: string): boolean | null {
  return typeof config[key] === 'boolean' ? config[key] : null;
}

function numberConfig(config: Record<string, unknown>, key: string): number | null {
  return typeof config[key] === 'number' && Number.isFinite(config[key]) ? config[key] : null;
}

function stringConfig(config: Record<string, unknown>, key: string): string | null {
  return typeof config[key] === 'string' ? config[key] : null;
}

function arrayConfig(config: Record<string, unknown>, key: string): unknown[] {
  const value = config[key];
  return Array.isArray(value) ? value : [];
}

function stringArrayConfig(config: Record<string, unknown>, key: string): string[] {
  return arrayConfig(config, key).filter((item): item is string => typeof item === 'string');
}

function check(
  checks: SerumConfigTestCheckDto[],
  id: string,
  label: string,
  status: SerumConfigTestCheckDto['status'],
  detail: string,
) {
  checks.push({ id, label, status, detail });
}

function finalTestStatus(checks: SerumConfigTestCheckDto[]): SerumConfigTestResultDto['status'] {
  if (checks.some((item) => item.status === 'fail')) return 'fail';
  if (checks.some((item) => item.status === 'warn')) return 'warn';
  return 'pass';
}

function validateGenericSerumConfig(
  checks: SerumConfigTestCheckDto[],
  config: Record<string, unknown>,
  configType: SerumConfigTypeValue,
  environment: SerumConfigEnvironmentValue,
) {
  const rawSecretPaths = collectRawSecretMaterial(config);
  check(
    checks,
    'secret-material',
    'Secret material',
    rawSecretPaths.length > 0 ? 'fail' : 'pass',
    rawSecretPaths.length > 0
      ? `Raw secret-looking fields found at ${rawSecretPaths.join(', ')}. Use secretRef fields.`
      : 'No raw API key, password, credential, private key, or secret fields were found.',
  );

  check(
    checks,
    'json-object',
    'JSON object',
    Object.keys(config).length > 0 ? 'pass' : 'warn',
    Object.keys(config).length > 0
      ? 'Config is a non-empty JSON object.'
      : 'Config is empty; save an explicit policy before production rollout.',
  );

  if (environment === 'production' && HIGH_RISK_CONFIG_TYPES.has(configType)) {
    const productionApproval =
      boolConfig(config, 'approvalRequiredForProduction') ??
      boolConfig(config, 'humanApprovalRequired') ??
      boolConfig(config, 'requiredBeforePublish');
    check(
      checks,
      'production-approval',
      'Production approval',
      productionApproval === true ? 'pass' : 'fail',
      productionApproval === true
        ? 'Production changes require an approval gate.'
        : 'High-risk production SERUM sections must require approval before publish.',
    );
  }
}

function validateGeneralConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const safeMode = boolConfig(config, 'safeMode');
  const actionMode = stringConfig(config, 'actionMode');
  check(
    checks,
    'general-safe-mode',
    'Safe mode',
    safeMode === true || actionMode === 'read_only' ? 'pass' : 'fail',
    safeMode === true || actionMode === 'read_only'
      ? 'General deployment posture is fail-closed.'
      : 'General deployment must keep safeMode=true unless actionMode is read_only.',
  );
  check(
    checks,
    'general-pricing',
    'Pricing boundary',
    String(config.pricingMode ?? '').includes('deterministic') ? 'pass' : 'warn',
    String(config.pricingMode ?? '').includes('deterministic')
      ? 'Pricing stays behind deterministic tools.'
      : 'Pricing policy should explicitly prefer deterministic tools before model assistance.',
  );
}

function validateFeatureFlagsConfig(
  checks: SerumConfigTestCheckDto[],
  config: Record<string, unknown>,
  environment: SerumConfigEnvironmentValue,
) {
  const killSwitch = boolConfig(config, 'killSwitch');
  const demoMode = boolConfig(config, 'demoMode');
  check(
    checks,
    'feature-kill-switch',
    'Kill switch',
    killSwitch === true ? 'pass' : 'fail',
    killSwitch === true
      ? 'Runtime kill switch is explicitly enabled.'
      : 'Runtime feature flags must include killSwitch=true.',
  );
  check(
    checks,
    'feature-demo-mode',
    'Demo mode boundary',
    environment === 'production' && demoMode === true ? 'fail' : 'pass',
    environment === 'production' && demoMode === true
      ? 'Demo mode cannot be enabled in production.'
      : 'Demo mode setting is compatible with this environment.',
  );
}

function validateAgentsConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const enabled = boolConfig(config, 'enabled') === true;
  const autonomy = stringConfig(config, 'autonomy') ?? 'disabled';
  const allowedAgentIds = stringArrayConfig(config, 'allowedAgentIds');
  const maxConcurrentRuns = numberConfig(config, 'maxConcurrentRuns');
  const humanApprovalRequired = boolConfig(config, 'humanApprovalRequired');
  check(
    checks,
    'agents-approval',
    'Human approval',
    humanApprovalRequired === true ? 'pass' : enabled ? 'fail' : 'warn',
    humanApprovalRequired === true
      ? 'Agent runs require human approval.'
      : enabled
        ? 'Enabled agent registries must require human approval.'
        : 'Disabled registries should still keep humanApprovalRequired=true before rollout.',
  );
  check(
    checks,
    'agents-allowlist',
    'Agent allowlist',
    !enabled || allowedAgentIds.length > 0 ? 'pass' : 'fail',
    !enabled
      ? 'Agent registry is disabled; allowlist is not required yet.'
      : 'Enabled agent registries need at least one explicit allowedAgentId.',
  );
  check(
    checks,
    'agents-concurrency',
    'Concurrency cap',
    !enabled || (maxConcurrentRuns !== null && maxConcurrentRuns >= 1 && maxConcurrentRuns <= 25)
      ? 'pass'
      : 'fail',
    !enabled
      ? 'Disabled agent registry cannot start concurrent runs.'
      : 'Enabled agent registry must set maxConcurrentRuns between 1 and 25.',
  );
  check(
    checks,
    'agents-autonomy',
    'Autonomy mode',
    /unrestricted|write|autonomous/i.test(autonomy) ? 'fail' : 'pass',
    /unrestricted|write|autonomous/i.test(autonomy)
      ? 'Unrestricted or write-capable autonomy cannot pass this gate.'
      : 'Autonomy mode stays bounded.',
  );
}

function validateLoopsConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const durableEventsRequired = boolConfig(config, 'durableEventsRequired');
  const stopOnApprovalGate = boolConfig(config, 'stopOnApprovalGate');
  const maxRetries = numberConfig(config, 'maxRetries');
  const replayMode = stringConfig(config, 'replayMode') ?? 'manual_only';
  check(
    checks,
    'loops-durable-events',
    'Durable events',
    durableEventsRequired === true ? 'pass' : 'fail',
    durableEventsRequired === true
      ? 'Loop execution requires durable events.'
      : 'SERUM loops cannot run without durable events.',
  );
  check(
    checks,
    'loops-approval-stop',
    'Approval boundary',
    stopOnApprovalGate === true ? 'pass' : 'fail',
    stopOnApprovalGate === true
      ? 'Loops stop at approval gates.'
      : 'Loops must stop when an approval gate is reached.',
  );
  check(
    checks,
    'loops-retries',
    'Retry cap',
    maxRetries !== null && maxRetries >= 0 && maxRetries <= 3 ? 'pass' : 'warn',
    maxRetries !== null && maxRetries >= 0 && maxRetries <= 3
      ? 'Retry count is bounded.'
      : 'Set maxRetries between 0 and 3 for predictable recovery.',
  );
  check(
    checks,
    'loops-replay',
    'Replay mode',
    /auto|continuous/i.test(replayMode) ? 'fail' : 'pass',
    /auto|continuous/i.test(replayMode)
      ? 'Automatic replay is blocked until replay audits and approvals are enforced.'
      : 'Replay mode is manual or bounded.',
  );
}

function validateModelRouterConfig(
  checks: SerumConfigTestCheckDto[],
  config: Record<string, unknown>,
  environment: SerumConfigEnvironmentValue,
) {
  const defaultProvider = stringConfig(config, 'defaultProvider') ?? 'not_configured';
  const maxTokens = numberConfig(config, 'maxTokensPerRequest');
  const secretRefs = stringArrayConfig(config, 'secretRefs');
  const requireSourceCitations = boolConfig(config, 'requireSourceCitations');
  const uncertaintyMode = stringConfig(config, 'uncertaintyMode') ?? '';
  check(
    checks,
    'router-provider',
    'Provider route',
    defaultProvider !== 'not_configured' && secretRefs.length > 0
      ? 'pass'
      : environment === 'production'
        ? 'fail'
        : 'warn',
    defaultProvider !== 'not_configured' && secretRefs.length > 0
      ? 'Provider route and secret references are configured.'
      : 'Configure a default provider and secretRefs before production use.',
  );
  check(
    checks,
    'router-citations',
    'Source citations',
    requireSourceCitations === true ? 'pass' : 'fail',
    requireSourceCitations === true
      ? 'Model answers require source citations.'
      : 'Model router must require source citations for CRM/legal answers.',
  );
  check(
    checks,
    'router-token-cap',
    'Token cap',
    maxTokens !== null && maxTokens > 0 && maxTokens <= 8000 ? 'pass' : 'warn',
    maxTokens !== null && maxTokens > 0 && maxTokens <= 8000
      ? 'Per-request token budget is bounded.'
      : 'Set maxTokensPerRequest between 1 and 8000 before rollout.',
  );
  check(
    checks,
    'router-uncertainty',
    'Uncertainty behavior',
    /answer_anyway|never_abstain/i.test(uncertaintyMode) ? 'fail' : 'pass',
    /answer_anyway|never_abstain/i.test(uncertaintyMode)
      ? 'Router cannot force answers when evidence is weak.'
      : 'Uncertainty behavior allows bounded answers or abstention.',
  );
}

function validateToolsConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const enabled = boolConfig(config, 'enabled') === true;
  const allowWriteTools = boolConfig(config, 'allowWriteTools') === true;
  const requireDryRun = boolConfig(config, 'requireDryRunForWriteTools');
  const allowedTools = arrayConfig(config, 'allowedTools');
  const registryMode = stringConfig(config, 'registryMode') ?? '';
  check(
    checks,
    'tools-registry-mode',
    'Registry mode',
    registryMode === 'explicit_allowlist' ? 'pass' : 'fail',
    registryMode === 'explicit_allowlist'
      ? 'Tool execution is bound to an explicit allowlist.'
      : 'Tool registry must use explicit_allowlist mode.',
  );
  check(
    checks,
    'tools-write-safety',
    'Write-tool safety',
    !allowWriteTools || requireDryRun === true ? 'pass' : 'fail',
    !allowWriteTools
      ? 'Write tools are disabled.'
      : 'Write tools require dry-run before execution.',
  );
  check(
    checks,
    'tools-allowlist',
    'Tool allowlist',
    !enabled || allowedTools.length > 0 ? 'pass' : 'fail',
    !enabled
      ? 'Tool registry is disabled; no executable tools are exposed.'
      : 'Enabled tool registry requires at least one explicitly allowed tool.',
  );
}

function validateConnectorsConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const enabled = boolConfig(config, 'enabled') === true;
  const requireConnectionTest = boolConfig(config, 'requireConnectionTest');
  const secretRefs = stringArrayConfig(config, 'secretRefs');
  const connectorMode = stringConfig(config, 'connectorMode') ?? '';
  check(
    checks,
    'connectors-test-before-publish',
    'Connection test',
    !enabled || requireConnectionTest === true ? 'pass' : 'fail',
    !enabled
      ? 'Connectors are disabled; publish-time connection tests are not required yet.'
      : 'Enabled connectors must require a connection test before publish.',
  );
  check(
    checks,
    'connectors-secret-refs',
    'Connector secrets',
    !enabled || secretRefs.length > 0 ? 'pass' : 'fail',
    !enabled
      ? 'Disabled connectors do not expose credentials.'
      : 'Enabled connectors need secretRefs instead of inline credentials.',
  );
  check(
    checks,
    'connectors-mode',
    'Connector mode',
    /write/i.test(connectorMode) ? 'warn' : 'pass',
    /write/i.test(connectorMode)
      ? 'Write-capable connector mode needs a section-specific approval gate.'
      : 'Connector mode is read-only or manual.',
  );
}

function validateDustMcpGatewayConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const dustEnabled = boolConfig(config, 'dustEnabled') === true;
  const mcpEnabled = boolConfig(config, 'mcpEnabled') === true;
  const enabled = dustEnabled || mcpEnabled;
  const writeMode = stringConfig(config, 'writeMode') ?? 'disabled';
  const secretRefs = stringArrayConfig(config, 'secretRefs');
  const requireToolAudit = boolConfig(config, 'requireToolAudit');

  check(
    checks,
    'gateway-secret-refs',
    'Gateway secrets',
    !enabled || secretRefs.length > 0 ? 'pass' : 'fail',
    !enabled
      ? 'Dust/MCP Gateway is disabled; no runtime secrets are exposed.'
      : 'Enabled Dust/MCP Gateway requires secretRefs instead of inline credentials.',
  );
  check(
    checks,
    'gateway-write-mode',
    'Gateway write mode',
    ['disabled', 'draft_only', 'approval_required'].includes(writeMode) ? 'pass' : 'fail',
    ['disabled', 'draft_only', 'approval_required'].includes(writeMode)
      ? 'Gateway write mode is one of the safe runtime modes.'
      : 'Gateway writeMode must be disabled, draft_only, or approval_required.',
  );
  check(
    checks,
    'gateway-tool-audit',
    'Gateway audit trail',
    !enabled || requireToolAudit === true ? 'pass' : 'fail',
    !enabled
      ? 'Dust/MCP Gateway is disabled; runtime audit enforcement is inactive.'
      : 'Enabled Dust/MCP Gateway requires tool audit evidence.',
  );
  check(
    checks,
    'gateway-mcp-dust-toggle',
    'Gateway enablement',
    enabled ? 'warn' : 'pass',
    enabled
      ? 'Gateway is enabled; runtime policy will fail closed on disabled write mode, missing approval, or missing audit evidence.'
      : 'Gateway is disabled by default.',
  );
}

function validateRetrievalConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const enabled = boolConfig(config, 'enabled') === true;
  const requireGroundedSources = boolConfig(config, 'requireGroundedSources');
  const minimumConfidence = numberConfig(config, 'minimumConfidence');
  const maxChunks = numberConfig(config, 'maxChunks');
  const noSourceBehavior = stringConfig(config, 'noSourceBehavior') ?? '';
  check(
    checks,
    'retrieval-grounded-sources',
    'Grounded sources',
    !enabled || requireGroundedSources === true ? 'pass' : 'fail',
    !enabled
      ? 'Retrieval is disabled; grounded-source enforcement is dormant.'
      : 'Enabled retrieval must require grounded sources.',
  );
  check(
    checks,
    'retrieval-confidence-threshold',
    'Confidence threshold',
    minimumConfidence !== null && minimumConfidence >= 0.7 && minimumConfidence <= 1
      ? 'pass'
      : 'fail',
    minimumConfidence !== null && minimumConfidence >= 0.7 && minimumConfidence <= 1
      ? 'Retrieval confidence threshold is bounded.'
      : 'Set minimumConfidence between 0.70 and 1.00 before semantic retrieval is enabled.',
  );
  check(
    checks,
    'retrieval-chunk-cap',
    'Chunk cap',
    maxChunks !== null && maxChunks >= 1 && maxChunks <= 25 ? 'pass' : 'fail',
    maxChunks !== null && maxChunks >= 1 && maxChunks <= 25
      ? 'Retrieval chunk count is bounded.'
      : 'Set maxChunks between 1 and 25 before semantic retrieval is enabled.',
  );
  check(
    checks,
    'retrieval-no-source-behavior',
    'No-source behavior',
    /answer_anyway|ignore_sources|ungrounded/i.test(noSourceBehavior) ? 'fail' : 'pass',
    /answer_anyway|ignore_sources|ungrounded/i.test(noSourceBehavior)
      ? 'Retrieval cannot answer without sources.'
      : 'No-source behavior stays bounded or uncertain.',
  );
}

function validatePromptLibraryConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const versionedPromptsRequired = boolConfig(config, 'versionedPromptsRequired');
  const promptInjectionTestsRequired = boolConfig(config, 'promptInjectionTestsRequired');
  const approvalRequiredForProduction = boolConfig(config, 'approvalRequiredForProduction');
  const allowedPromptSets = stringArrayConfig(config, 'allowedPromptSets');
  check(
    checks,
    'prompts-versioning',
    'Prompt versioning',
    versionedPromptsRequired === true ? 'pass' : 'fail',
    versionedPromptsRequired === true
      ? 'Prompt updates require versioning.'
      : 'Prompt library must require versioned prompts.',
  );
  check(
    checks,
    'prompts-injection-tests',
    'Injection tests',
    promptInjectionTestsRequired === true ? 'pass' : 'fail',
    promptInjectionTestsRequired === true
      ? 'Prompt-injection tests are required before release.'
      : 'Prompt library must require prompt-injection tests.',
  );
  check(
    checks,
    'prompts-production-approval',
    'Production approval',
    approvalRequiredForProduction === true ? 'pass' : 'fail',
    approvalRequiredForProduction === true
      ? 'Production prompt changes require approval.'
      : 'Production prompt changes must require approval.',
  );
  check(
    checks,
    'prompts-allowlist',
    'Prompt allowlist',
    allowedPromptSets.length > 0 ? 'pass' : 'fail',
    allowedPromptSets.length > 0
      ? 'Prompt execution is bound to explicit allowed prompt sets.'
      : 'Prompt library must define allowedPromptSets before runtime execution.',
  );
}

function validateEvalsConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const requiredBeforePublish = boolConfig(config, 'requiredBeforePublish');
  const minimumPassRate = numberConfig(config, 'minimumPassRate');
  const blockOnFailure = boolConfig(config, 'blockOnFailure');
  const suites = stringArrayConfig(config, 'regressionSuites');
  check(
    checks,
    'evals-required',
    'Required before publish',
    requiredBeforePublish === true ? 'pass' : 'fail',
    requiredBeforePublish === true
      ? 'Evals are required before publish.'
      : 'Evals must be required before publish for SERUM changes.',
  );
  check(
    checks,
    'evals-pass-rate',
    'Pass threshold',
    minimumPassRate !== null && minimumPassRate >= 0.98
      ? 'pass'
      : minimumPassRate !== null && minimumPassRate >= 0.95
        ? 'warn'
        : 'fail',
    minimumPassRate !== null && minimumPassRate >= 0.98
      ? 'Minimum pass rate meets the 98% gate.'
      : 'Set minimumPassRate to at least 0.98 for release gates.',
  );
  check(
    checks,
    'evals-block-on-failure',
    'Block on failure',
    blockOnFailure === true ? 'pass' : 'fail',
    blockOnFailure === true
      ? 'Release is blocked on eval failure.'
      : 'Release must block when evals fail.',
  );
  check(
    checks,
    'evals-injection-suite',
    'Injection regression',
    suites.includes('prompt_injection') ? 'pass' : 'fail',
    suites.includes('prompt_injection')
      ? 'Prompt-injection regression suite is included.'
      : 'Add prompt_injection to regressionSuites.',
  );
}

function validateApprovalConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const requiredForExternalWrites = boolConfig(config, 'requiredForExternalWrites');
  const requiredForLegal = boolConfig(config, 'requiredForLegal');
  const requiredForPricingExceptions = boolConfig(config, 'requiredForPricingExceptions');
  check(
    checks,
    'approvals-required-surfaces',
    'Approval surfaces',
    requiredForExternalWrites === true &&
      requiredForLegal === true &&
      requiredForPricingExceptions === true
      ? 'pass'
      : 'fail',
    'Legal, pricing exceptions, and external writes must all require approval.',
  );
}

function validatePermissionsConfig(checks: SerumConfigTestCheckDto[], config: Record<string, unknown>) {
  const adminRoleRequired = boolConfig(config, 'adminRoleRequired');
  const tenantIsolationRequired = boolConfig(config, 'tenantIsolationRequired');
  check(
    checks,
    'permissions-admin-tenant',
    'Admin and tenant boundary',
    adminRoleRequired === true && tenantIsolationRequired === true ? 'pass' : 'fail',
    adminRoleRequired === true && tenantIsolationRequired === true
      ? 'Admin writes and tenant isolation are required.'
      : 'SERUM policy writes must require admin role and tenant isolation.',
  );
}

function testSerumConfig(args: {
  configType: SerumConfigTypeValue;
  configKey: string;
  environment: SerumConfigEnvironmentValue;
  configJson: Record<string, unknown>;
}): SerumConfigTestResultDto {
  const checks: SerumConfigTestCheckDto[] = [];
  validateGenericSerumConfig(checks, args.configJson, args.configType, args.environment);

  switch (args.configType) {
    case 'general':
      validateGeneralConfig(checks, args.configJson);
      break;
    case 'feature_flags':
      validateFeatureFlagsConfig(checks, args.configJson, args.environment);
      break;
    case 'agents':
      validateAgentsConfig(checks, args.configJson);
      break;
    case 'loops':
      validateLoopsConfig(checks, args.configJson);
      break;
    case 'model_router':
      validateModelRouterConfig(checks, args.configJson, args.environment);
      break;
    case 'tools':
      validateToolsConfig(checks, args.configJson);
      break;
    case 'connectors':
      validateConnectorsConfig(checks, args.configJson);
      break;
    case 'retrieval':
      validateRetrievalConfig(checks, args.configJson);
      break;
    case 'dust_mcp_gateway':
      validateDustMcpGatewayConfig(checks, args.configJson);
      break;
    case 'prompt_library':
      validatePromptLibraryConfig(checks, args.configJson);
      break;
    case 'evals_quality_gates':
      validateEvalsConfig(checks, args.configJson);
      break;
    case 'approvals':
      validateApprovalConfig(checks, args.configJson);
      break;
    case 'permissions_policies':
      validatePermissionsConfig(checks, args.configJson);
      break;
    default:
      check(
        checks,
        'section-specific-validator',
        'Section validator',
        'warn',
        'This section uses generic JSON and secret-policy validation; typed domain enforcement is still pending.',
      );
  }

  const status = finalTestStatus(checks);
  return SerumConfigTestResult.parse({
    configType: args.configType,
    configKey: args.configKey,
    environment: args.environment,
    checkedAt: new Date().toISOString(),
    status,
    summary:
      status === 'pass'
        ? 'All deterministic SERUM config checks passed.'
        : status === 'warn'
          ? 'SERUM config has warnings that must be reviewed before rollout.'
          : 'SERUM config failed one or more production safety checks.',
    checks,
  });
}

function serializeConfigVersion(
  row: Prisma.SerumConfigVersionGetPayload<object>,
  currentUserId: string,
): SerumConfigVersionDto {
  return SerumConfigVersion.parse({
    id: row.id,
    orgId: row.orgId,
    configType: row.configType,
    configKey: row.configKey,
    version: row.version,
    status: row.status,
    environment: row.environment,
    configJson: asJsonObject(row.configJson),
    createdByUserId: row.createdByUserId,
    approvedByUserId: row.approvedByUserId,
    approvalStatus: row.approvalStatus,
    approvalRequestedAt: iso(row.approvalRequestedAt),
    approvalRequestedByUserId: row.approvalRequestedByUserId,
    approvalRequestedByCurrentUser: row.approvalRequestedByUserId === currentUserId,
    approvalApprovedAt: iso(row.approvalApprovedAt),
    approvalReference: row.approvalReference,
    createdAt: row.createdAt.toISOString(),
    activatedAt: iso(row.activatedAt),
    rollbackOfConfigVersionId: row.rollbackOfConfigVersionId,
    changeReason: row.changeReason,
  });
}

function serializeConfigAuditEntry(
  row: Prisma.AuditLogGetPayload<object>,
): SerumConfigAuditEntryDto {
  return SerumConfigAuditEntry.parse({
    id: row.id.toString(),
    action: row.action,
    targetId: row.targetId,
    userId: row.userId,
    diff: row.diff ?? null,
    createdAt: row.at.toISOString(),
  });
}

async function nextConfigVersion(
  tx: Prisma.TransactionClient,
  orgId: string,
  configType: string,
  configKey: string,
  environment: string,
): Promise<number> {
  const latest = await tx.serumConfigVersion.aggregate({
    where: { orgId, configType, configKey, environment, deletedAt: null },
    _max: { version: true },
  });
  return (latest._max.version ?? 0) + 1;
}

function configLockKey(
  orgId: string,
  configType: string,
  configKey: string,
  environment: string,
): string {
  return `${orgId}:serum_config:${configType}:${configKey}:${environment}`;
}

function providerStatus(status: string): SerumSignalStatus {
  const normalized = status.toLowerCase();
  if (['healthy', 'ok', 'ready', 'success', 'online'].includes(normalized)) return 'ready';
  if (['degraded', 'warning', 'slow'].includes(normalized)) return 'attention';
  if (['down', 'failed', 'error', 'offline'].includes(normalized)) return 'blocked';
  return 'attention';
}

function queueStatus(row: QueueHealthRow): SerumSignalStatus {
  if (row.failed > 0) return 'attention';
  if (row.active > 0 || row.waiting > 0) return 'active';
  return 'ready';
}

function statusForCount(count: number, empty: SerumSignalStatus = 'empty'): SerumSignalStatus {
  return count > 0 ? 'active' : empty;
}

function signalTableLabels(): Array<[keyof SignalTableAvailability, string]> {
  return [
    ['crew_agents', 'crew agents'],
    ['crew_runs', 'crew runs'],
    ['rfp_orchestrations', 'RFP orchestrations'],
    ['document_versions', 'document versions'],
    ['approval_gates', 'approval gates'],
    ['ai_invocations', 'AI invocation audit'],
    ['audit_log', 'audit log'],
  ];
}

function signalHealthStatus(rows: SerumSignalStatus[], empty: SerumSignalStatus = 'empty'): SerumSignalStatus {
  if (rows.length === 0) return empty;
  if (rows.includes('blocked') || rows.includes('error')) return 'blocked';
  if (rows.includes('attention')) return 'attention';
  if (rows.includes('active')) return 'active';
  return 'ready';
}

function buildSignalHealth(args: {
  tables: SignalTableAvailability;
  providerRows: ProviderHealthRow[];
  queueRows: QueueHealthRow[];
  providerConfigured: boolean;
  dustConfigured: boolean;
  mcpConfigured: boolean;
}): SerumBackendSignal[] {
  const tableEntries = signalTableLabels();
  const missingTables = tableEntries
    .filter(([key]) => !args.tables[key])
    .map(([, label]) => label);
  const availableTableCount = tableEntries.length - missingTables.length;
  const providerStatuses = args.providerRows.map((row) => providerStatus(row.status));
  const providerSignalStatus: SerumSignalStatus = !args.tables.provider_health
    ? 'not_configured'
    : signalHealthStatus(providerStatuses);
  const queueSignalStatus: SerumSignalStatus = !args.tables.queue_health
    ? 'not_configured'
    : args.queueRows.length === 0
      ? 'empty'
      : args.queueRows.some((row) => row.failed > 0)
        ? 'attention'
        : 'ready';

  return [
    {
      id: 'source-tables',
      label: 'Source tables',
      status:
        missingTables.length === 0
          ? 'ready'
          : availableTableCount > 0
            ? 'attention'
            : 'not_configured',
      detail:
        missingTables.length === 0
          ? `${availableTableCount}/${tableEntries.length} backend signal tables are available.`
          : `${availableTableCount}/${tableEntries.length} backend signal tables are available. Missing: ${missingTables.join(', ')}.`,
    },
    {
      id: 'provider-heartbeats',
      label: 'Provider heartbeats',
      status: providerSignalStatus,
      detail: !args.tables.provider_health
        ? 'provider_health table is not available in this database.'
        : args.providerRows.length > 0
          ? `${args.providerRows.length} provider heartbeat row${args.providerRows.length === 1 ? '' : 's'} returned.`
          : 'provider_health table is available, but no provider heartbeat rows are recorded for this org.',
    },
    {
      id: 'queue-heartbeats',
      label: 'Queue heartbeats',
      status: queueSignalStatus,
      detail: !args.tables.queue_health
        ? 'queue_health table is not available in this database.'
        : args.queueRows.length > 0
          ? `${args.queueRows.length} queue heartbeat row${args.queueRows.length === 1 ? '' : 's'} returned.`
          : 'queue_health table is available, but no queue heartbeat rows are recorded for this org.',
    },
    {
      id: 'provider-access',
      label: 'Provider access',
      status: args.providerConfigured || args.dustConfigured ? 'ready' : 'not_configured',
      detail: args.providerConfigured || args.dustConfigured
        ? 'At least one org model provider or Dust fallback path is configured.'
        : 'No org model provider or Dust fallback credentials are configured.',
    },
    {
      id: 'dust-mcp-gateway',
      label: 'Dust/MCP gateway',
      status:
        args.dustConfigured && args.mcpConfigured
          ? 'ready'
          : args.dustConfigured || args.mcpConfigured
            ? 'attention'
            : 'not_configured',
      detail:
        args.dustConfigured && args.mcpConfigured
          ? 'Dust credentials and MCP public URL are configured.'
          : args.dustConfigured
            ? 'Dust credentials are configured, but MCP public URL is missing.'
            : args.mcpConfigured
              ? 'MCP public URL is configured, but Dust credentials are missing for this org.'
              : 'Dust credentials and MCP public URL are not configured.',
    },
  ];
}

async function readSignal<T>(
  log: WarnLogger,
  label: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    log.warn({ err, signal: label }, 'SERUM backend signal unavailable');
    return fallback;
  }
}

function signalSql(available: boolean | null | undefined, sql: Prisma.Sql): Prisma.Sql {
  return available ? sql : Prisma.sql`0::int`;
}

function latestConfigSql(available: boolean | null | undefined, orgId: string): Prisma.Sql {
  if (!available) return Prisma.sql`NULL::timestamptz`;
  return Prisma.sql`
    (
      SELECT MAX(at)
      FROM audit_log
      WHERE org_id = ${orgId}::uuid
        AND deleted_at IS NULL
        AND (
          action LIKE 'agent_provider.%'
          OR action LIKE 'dust.%'
          OR action LIKE 'org_settings.%'
          OR action LIKE 'rbac.%'
          OR action LIKE 'serum_config.%'
        )
    )
  `;
}

async function readSignalTableAvailability(log: WarnLogger): Promise<SignalTableAvailability> {
  const rows = await readSignal(
    log,
    'serum_signal_table_availability',
    () => prisma.$queryRaw<SignalTableAvailability[]>`
      SELECT
        to_regclass('crew_agents') IS NOT NULL AS crew_agents,
        to_regclass('crew_runs') IS NOT NULL AS crew_runs,
        to_regclass('rfp_orchestrations') IS NOT NULL AS rfp_orchestrations,
        to_regclass('document_versions') IS NOT NULL AS document_versions,
        to_regclass('approval_gates') IS NOT NULL AS approval_gates,
        to_regclass('ai_invocations') IS NOT NULL AS ai_invocations,
        to_regclass('audit_log') IS NOT NULL AS audit_log,
        to_regclass('provider_health') IS NOT NULL AS provider_health,
        to_regclass('queue_health') IS NOT NULL AS queue_health
    `,
    [emptyTableAvailability],
  );
  return rows[0] ?? emptyTableAvailability;
}

async function readCoreSignals(
  log: WarnLogger,
  orgId: string,
  today: Date,
  tables: SignalTableAvailability,
): Promise<CoreSignalRow> {
  const activeAgentsSql = signalSql(
    tables.crew_agents,
    Prisma.sql`
      (
        SELECT COUNT(*)::int
        FROM crew_agents
        WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL
      )
    `,
  );
  const activeCrewRunsSql = signalSql(
    tables.crew_runs,
    Prisma.sql`
      (
        SELECT COUNT(*)::int
        FROM crew_runs
        WHERE org_id = ${orgId}::uuid AND status IN ('queued', 'running')
      )
    `,
  );
  const activeRfpRunsSql = signalSql(
    tables.rfp_orchestrations,
    Prisma.sql`
      (
        SELECT COUNT(*)::int
        FROM rfp_orchestrations
        WHERE org_id = ${orgId}::uuid
          AND state IN ('queued', 'running', 'awaiting_approval')
          AND deleted_at IS NULL
      )
    `,
  );
  const failedRfpRunsSql = signalSql(
    tables.rfp_orchestrations,
    Prisma.sql`
      (
        SELECT COUNT(*)::int
        FROM rfp_orchestrations
        WHERE org_id = ${orgId}::uuid
          AND state = 'failed'
          AND deleted_at IS NULL
      )
    `,
  );
  const documentsProcessedSql = signalSql(
    tables.document_versions,
    Prisma.sql`
      (
        SELECT COUNT(*)::int
        FROM document_versions
        WHERE org_id = ${orgId}::uuid
          AND extraction_status = 'succeeded'
          AND created_at >= ${today}
          AND deleted_at IS NULL
      )
    `,
  );
  const failedDocumentsSql = signalSql(
    tables.document_versions,
    Prisma.sql`
      (
        SELECT COUNT(*)::int
        FROM document_versions
        WHERE org_id = ${orgId}::uuid
          AND extraction_status = 'failed'
          AND created_at >= ${today}
          AND deleted_at IS NULL
      )
    `,
  );
  const openApprovalsSql = signalSql(
    tables.approval_gates,
    Prisma.sql`
      (
        SELECT COUNT(*)::int
        FROM approval_gates
        WHERE org_id = ${orgId}::uuid
          AND status = 'pending'
          AND deleted_at IS NULL
      )
    `,
  );
  const modelCallsSql = signalSql(
    tables.ai_invocations,
    Prisma.sql`
      (
        SELECT COUNT(*)::int
        FROM ai_invocations
        WHERE org_id = ${orgId}::uuid AND created_at >= ${today}
      )
    `,
  );
  const modelTokensSql = signalSql(
    tables.ai_invocations,
    Prisma.sql`
      (
        SELECT COALESCE(SUM(token_count), 0)::int
        FROM ai_invocations
        WHERE org_id = ${orgId}::uuid AND created_at >= ${today}
      )
    `,
  );

  const rows = await readSignal(
    log,
    'serum_core_signals',
    () => prisma.$queryRaw<CoreSignalRow[]>(Prisma.sql`
      SELECT
        ${activeAgentsSql} AS active_agents,
        ${activeCrewRunsSql} AS active_crew_runs,
        ${activeRfpRunsSql} AS active_rfp_runs,
        ${failedRfpRunsSql} AS failed_rfp_runs,
        ${documentsProcessedSql} AS documents_processed_today,
        ${failedDocumentsSql} AS failed_documents_today,
        ${openApprovalsSql} AS open_approvals,
        ${modelCallsSql} AS model_calls_today,
        ${modelTokensSql} AS model_tokens_today,
        ${latestConfigSql(tables.audit_log, orgId)} AS latest_config_change_at
    `),
    [emptyCoreSignals],
  );
  return rows[0] ?? emptyCoreSignals;
}

export const serumRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/serum/status',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: { response: { 200: SerumStatusSnapshot } },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const env = getEnv();
      const orgId = req.auth.orgId;
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const signalTables = await readSignalTableAvailability(req.log);
      const coreSignalsPromise = readCoreSignals(req.log, orgId, today, signalTables);

      const [
        coreSignals,
        queueRows,
        providerRows,
        providerCredentials,
        activeProvider,
        dustCredentials,
      ] = await Promise.all([
        coreSignalsPromise,
        signalTables.queue_health
          ? readSignal(
              req.log,
              'queue_health',
              () => prisma.$queryRaw<QueueHealthRow[]>`
                SELECT queue_name, waiting, active, failed, completed, last_checked_at
                FROM queue_health
                WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL
                ORDER BY last_checked_at DESC
                LIMIT 10
              `,
              [],
            )
          : Promise.resolve([]),
        signalTables.provider_health
          ? readSignal(
              req.log,
              'provider_health',
              () => prisma.$queryRaw<ProviderHealthRow[]>`
                SELECT provider, status, latency_ms, last_checked_at, message
                FROM provider_health
                WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL
                ORDER BY last_checked_at DESC
                LIMIT 8
              `,
              [],
            )
          : Promise.resolve([]),
        readSignal(req.log, 'agent_provider_credentials', () => listOrgAgentProviderCredentials(orgId), []),
        readSignal(req.log, 'active_agent_provider', () => getOrgActiveAgentProvider(orgId), null),
        readSignal(req.log, 'dust_credentials', () => resolveOrgDustCredentials(orgId), null),
      ]);

      const activeAgents = toInt(coreSignals.active_agents);
      const activeCrewRuns = toInt(coreSignals.active_crew_runs);
      const activeRfpRuns = toInt(coreSignals.active_rfp_runs);
      const activeLoops = activeCrewRuns + activeRfpRuns;
      const failedLoops = toInt(coreSignals.failed_rfp_runs);
      const documentsProcessedToday = toInt(coreSignals.documents_processed_today);
      const failedDocuments = toInt(coreSignals.failed_documents_today);
      const openApprovals = toInt(coreSignals.open_approvals);
      const modelCallsToday = toInt(coreSignals.model_calls_today);
      const modelTokensToday = toInt(coreSignals.model_tokens_today);
      const queueFailed = queueRows.reduce((sum, row) => sum + row.failed, 0);
      const failedJobs = queueFailed + failedDocuments + failedLoops;
      const providerConfigured = Boolean(activeProvider) || providerCredentials.length > 0;
      const dustConfigured = Boolean(dustCredentials);
      const mcpConfigured = Boolean(env.DUST_MCP_PUBLIC_URL);
      const enabled = env.SERUM_ENABLED === 'true';
      const signalHealth = buildSignalHealth({
        tables: signalTables,
        providerRows,
        queueRows,
        providerConfigured,
        dustConfigured,
        mcpConfigured,
      });

      const cards: SerumStatusCard[] = [
        {
          id: 'enabled',
          title: 'SERUM status',
          value: enabled ? 'Enabled' : 'Disabled',
          detail: enabled
            ? 'Control-plane surfaces are available for this deployment.'
            : 'SERUM_ENABLED is false, so no autonomous loops are exposed.',
          status: enabled ? 'ready' : 'disabled',
          href: '/settings?tab=serum',
        },
        {
          id: 'agents',
          title: 'Crew agents',
          value: String(activeAgents),
          detail: 'Configured agent personas in this organization.',
          status: statusForCount(activeAgents, 'empty'),
          href: '/agent-studio',
        },
        {
          id: 'loops',
          title: 'Active loops',
          value: String(activeLoops),
          detail: `${activeCrewRuns} crew runs and ${activeRfpRuns} RFP orchestrations currently active.`,
          status: statusForCount(activeLoops, 'ready'),
        },
        {
          id: 'documents',
          title: 'Documents today',
          value: String(documentsProcessedToday),
          detail:
            failedDocuments > 0
              ? `${failedDocuments} extraction jobs failed today.`
              : 'Successful RFP document extractions today.',
          status: failedDocuments > 0 ? 'attention' : statusForCount(documentsProcessedToday, 'empty'),
          href: '/intake',
        },
        {
          id: 'approvals',
          title: 'Open approvals',
          value: String(openApprovals),
          detail: 'Human review gates awaiting a decision.',
          status: statusForCount(openApprovals, 'ready'),
        },
        {
          id: 'models',
          title: 'Model calls today',
          value: String(modelCallsToday),
          detail: `${modelTokensToday.toLocaleString('en-US')} tokens recorded in AI audit telemetry.`,
          status: modelCallsToday > 0 ? 'active' : providerConfigured || dustConfigured ? 'ready' : 'not_configured',
          href: '/settings?tab=integrations',
        },
      ];

      const modules: SerumModuleStatus[] = [
        {
          id: 'mission-control',
          label: 'Agent Mission Control',
          status: enabled ? 'ready' : 'disabled',
          detail: enabled
            ? 'Read-only command surface is connected to live backend signals.'
            : 'Enable SERUM only after durable events, approvals, and policies are configured.',
          primaryAction: 'Review settings',
          href: '/settings?tab=serum',
        },
        {
          id: 'document-intelligence',
          label: 'Document intelligence',
          status: failedDocuments > 0 ? 'attention' : statusForCount(documentsProcessedToday, 'empty'),
          detail: 'RFP document extraction and source-chunk processing from existing jobs.',
          href: '/intake',
        },
        {
          id: 'agent-loops',
          label: 'Agent loops',
          status: activeLoops > 0 ? 'active' : activeAgents > 0 ? 'ready' : 'empty',
          detail: 'Crew runs and RFP orchestrations. Tool execution stays disabled until registry-backed.',
          href: '/agent-studio',
        },
        {
          id: 'model-router',
          label: 'Model router',
          status: providerConfigured || dustConfigured ? 'ready' : 'not_configured',
          detail: activeProvider
            ? `Org active provider: ${activeProvider}.`
            : dustConfigured
              ? 'Dust credentials are configured.'
              : 'No org model provider or Dust fallback configured.',
          href: '/settings?tab=integrations',
        },
        {
          id: 'dust-mcp',
          label: 'Dust and MCP gateway',
          status: dustConfigured && mcpConfigured ? 'ready' : dustConfigured || mcpConfigured ? 'attention' : 'not_configured',
          detail: dustConfigured
            ? mcpConfigured
              ? 'Dust credentials and MCP public URL are configured.'
              : 'Dust is configured; MCP public URL is missing.'
            : 'Dust credentials are not configured for this org or environment.',
          href: '/settings?tab=integrations',
        },
        {
          id: 'memory-patterns',
          label: 'Memory and pattern engine',
          status: 'not_configured',
          detail: 'No auto-learning is active. Promotion requires a future reviewed memory workflow.',
          href: '/settings?tab=serum',
        },
        {
          id: 'evals',
          label: 'Evals and ship gates',
          status: 'ready',
          detail: 'Existing RFP eval fixtures are available; SERUM-specific eval suites are not yet promoted.',
        },
      ];

      const providerHealth: SerumProviderHealth[] = providerRows.map((row) => ({
        provider: row.provider,
        status: providerStatus(row.status),
        latencyMs: row.latency_ms,
        lastCheckedAt: iso(row.last_checked_at),
        message: row.message,
      }));

      const queueHealth: SerumQueueHealth[] = queueRows.map((row) => ({
        queueName: row.queue_name,
        status: queueStatus(row),
        waiting: row.waiting,
        active: row.active,
        failed: row.failed,
        completed: row.completed,
        lastCheckedAt: iso(row.last_checked_at),
      }));

      return {
        generatedAt: new Date().toISOString(),
        environment: env.NODE_ENV,
        enabled,
        demoModeEnabled: env.SERUM_DEMO_MODE_ENABLED === 'true',
        summary: {
          activeAgents,
          activeLoops,
          documentsProcessedToday,
          failedJobs,
          openApprovals,
          modelCallsToday,
          modelTokensToday,
          providerConfigured,
          dustConfigured,
          mcpConfigured,
          latestConfigChangeAt: iso(coreSignals.latest_config_change_at),
        },
        cards,
        modules,
        providerHealth,
        queueHealth,
        signalHealth,
        guardrails: [
          'No fake production data or simulated agent activity.',
          'Autonomous actions stay disabled until durable events, approvals, and policies are implemented.',
          'Secrets are resolved only as booleans/status signals; no secret material leaves the server.',
          'Demo mode defaults off and is blocked in production.',
        ],
      };
    },
  );

  server.get(
    '/serum/runtime-policy',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        querystring: ConfigQuery,
        response: { 200: SerumRuntimePolicy },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return resolveSerumRuntimePolicy({
        orgId: req.auth.orgId,
        environment: req.query.environment ?? defaultConfigEnvironment(),
      });
    },
  );

  server.post(
    '/serum/runtime-policy/agents/:configKey/check',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        params: RuntimeConfigKeyParams,
        body: SerumRuntimeAgentCheckRequest,
        response: { 200: SerumRuntimeDecision },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return checkSerumAgentRuntimePolicy({
        orgId: req.auth.orgId,
        environment: req.body.environment,
        configKey: req.params.configKey,
        agentId: req.body.agentId,
        approvalConfirmed: req.body.approvalConfirmed,
      });
    },
  );

  server.post(
    '/serum/runtime-policy/tools/:configKey/check',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        params: RuntimeConfigKeyParams,
        body: SerumRuntimeToolCheckRequest,
        response: { 200: SerumRuntimeDecision },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return checkSerumToolRuntimePolicy({
        orgId: req.auth.orgId,
        environment: req.body.environment,
        configKey: req.params.configKey,
        toolName: req.body.toolName,
        dryRun: req.body.dryRun,
      });
    },
  );

  server.post(
    '/serum/runtime-policy/loops/:configKey/check',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        params: RuntimeConfigKeyParams,
        body: SerumRuntimeLoopCheckRequest,
        response: { 200: SerumRuntimeDecision },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return checkSerumLoopRuntimePolicy({
        orgId: req.auth.orgId,
        environment: req.body.environment,
        configKey: req.params.configKey,
        loopId: req.body.loopId,
        operation: req.body.operation,
        retryCount: req.body.retryCount,
        hasDurableEvent: req.body.hasDurableEvent,
        approvalGateReached: req.body.approvalGateReached,
        replayRequested: req.body.replayRequested,
        approvalConfirmed: req.body.approvalConfirmed,
      });
    },
  );

  server.post(
    '/serum/runtime-policy/connectors/:configKey/check',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        params: RuntimeConfigKeyParams,
        body: SerumRuntimeConnectorCheckRequest,
        response: { 200: SerumRuntimeDecision },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return checkSerumConnectorRuntimePolicy({
        orgId: req.auth.orgId,
        environment: req.body.environment,
        configKey: req.params.configKey,
        connectorId: req.body.connectorId,
        operation: req.body.operation,
        writeRequested: req.body.writeRequested,
        approvalConfirmed: req.body.approvalConfirmed,
      });
    },
  );

  server.post(
    '/serum/runtime-policy/model-router/:configKey/check',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        params: RuntimeConfigKeyParams,
        body: SerumRuntimeModelRouterCheckRequest,
        response: { 200: SerumRuntimeDecision },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return checkSerumModelRouterRuntimePolicy({
        orgId: req.auth.orgId,
        environment: req.body.environment,
        configKey: req.params.configKey,
        provider: req.body.provider,
        requestedMaxTokens: req.body.requestedMaxTokens,
        sourceCitationsRequired: req.body.sourceCitationsRequired,
      });
    },
  );

  server.post(
    '/serum/runtime-policy/dust-mcp-gateway/:configKey/check',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        params: RuntimeConfigKeyParams,
        body: SerumRuntimeDustMcpGatewayCheckRequest,
        response: { 200: SerumRuntimeDecision },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return checkSerumDustMcpGatewayRuntimePolicy({
        orgId: req.auth.orgId,
        environment: req.body.environment,
        configKey: req.params.configKey,
        operation: req.body.operation,
        writeRequested: req.body.writeRequested,
        approvalConfirmed: req.body.approvalConfirmed,
        toolAuditPresent: req.body.toolAuditPresent,
      });
    },
  );

  server.post(
    '/serum/runtime-policy/retrieval/:configKey/check',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        params: RuntimeConfigKeyParams,
        body: SerumRuntimeRetrievalCheckRequest,
        response: { 200: SerumRuntimeDecision },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return checkSerumRetrievalRuntimePolicy({
        orgId: req.auth.orgId,
        environment: req.body.environment,
        configKey: req.params.configKey,
        operation: req.body.operation,
        requestedChunks: req.body.requestedChunks,
        sourceBacked: req.body.sourceBacked,
        expectedConfidence: req.body.expectedConfidence,
      });
    },
  );

  server.post(
    '/serum/runtime-policy/prompt-library/:configKey/check',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        params: RuntimeConfigKeyParams,
        body: SerumRuntimePromptLibraryCheckRequest,
        response: { 200: SerumRuntimeDecision },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return checkSerumPromptLibraryRuntimePolicy({
        orgId: req.auth.orgId,
        environment: req.body.environment,
        configKey: req.params.configKey,
        operation: req.body.operation,
        promptSet: req.body.promptSet,
        versionedPrompt: req.body.versionedPrompt,
        injectionTested: req.body.injectionTested,
        productionApproved: req.body.productionApproved,
      });
    },
  );

  server.post(
    '/serum/runtime-policy/evals-quality-gates/:configKey/check',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        params: RuntimeConfigKeyParams,
        body: SerumRuntimeEvalsQualityGateCheckRequest,
        response: { 200: SerumRuntimeDecision },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return checkSerumEvalsQualityGateRuntimePolicy({
        orgId: req.auth.orgId,
        environment: req.body.environment,
        configKey: req.params.configKey,
        operation: req.body.operation,
        suite: req.body.suite,
        passRate: req.body.passRate,
        failedCount: req.body.failedCount,
      });
    },
  );

  server.get(
    '/serum/configs/:configType/:configKey',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: {
        params: ConfigParams,
        querystring: ConfigQuery,
        response: { 200: SerumConfigSnapshot },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const environment = req.query.environment ?? defaultConfigEnvironment();
      const versions = await prisma.serumConfigVersion.findMany({
        where: {
          orgId: req.auth.orgId,
          configType: req.params.configType,
          configKey: req.params.configKey,
          environment,
          deletedAt: null,
        },
        orderBy: [{ version: 'desc' }],
        take: 20,
      });
      const versionIds = versions.map((version) => version.id);
      const auditTrail = versionIds.length > 0
        ? await prisma.auditLog.findMany({
            where: {
              orgId: req.auth.orgId,
              targetType: 'serum_config_version',
              targetId: { in: versionIds },
              deletedAt: null,
            },
            orderBy: { at: 'desc' },
            take: 20,
          })
        : [];
      const serialized = versions.map((version) => serializeConfigVersion(version, req.auth.userId));
      return {
        active: serialized.find((row) => row.status === 'active') ?? null,
        draft: serialized.find((row) => row.status === 'draft') ?? null,
        versions: serialized,
        auditTrail: auditTrail.map(serializeConfigAuditEntry),
      };
    },
  );

  server.post(
    '/serum/configs/:configType/:configKey/test',
    {
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        params: ConfigParams,
        body: SerumConfigTestRequest,
        response: { 200: SerumConfigTestResult },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return testSerumConfig({
        configType: req.params.configType,
        configKey: req.params.configKey,
        environment: req.body.environment,
        configJson: asJsonObject(req.body.configJson),
      });
    },
  );

  server.post(
    '/serum/configs/:configType/:configKey/draft',
    {
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        params: ConfigParams,
        body: SerumConfigDraftUpsert,
        response: { 200: SerumConfigVersion },
      },
    },
    async (req) => {
      try {
        assertNoRawSecretMaterial(req.body.configJson);
      } catch (err) {
        throw server.httpErrors.badRequest(err instanceof Error ? err.message : 'Invalid configJson.');
      }

      const row = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${configLockKey(
            req.auth.orgId,
            req.params.configType,
            req.params.configKey,
            req.body.environment,
          )}))
        `;
        const version = await nextConfigVersion(
          tx,
          req.auth.orgId,
          req.params.configType,
          req.params.configKey,
          req.body.environment,
        );
        const created = await tx.serumConfigVersion.create({
          data: {
            orgId: req.auth.orgId,
            configType: req.params.configType,
            configKey: req.params.configKey,
            environment: req.body.environment,
            version,
            status: 'draft',
            approvalStatus: initialApprovalStatus(req.params.configType),
            configJson: toInputJsonObject(req.body.configJson),
            createdByUserId: req.auth.userId,
            changeReason: req.body.changeReason,
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'serum_config.draft.create',
            targetType: 'serum_config_version',
            targetId: created.id,
            diff: {
              configType: created.configType,
              configKey: created.configKey,
              environment: created.environment,
              version: created.version,
              approvalStatus: created.approvalStatus,
              changeReason: created.changeReason,
            },
          },
        });
        return created;
      });

      return serializeConfigVersion(row, req.auth.userId);
    },
  );

  server.post(
    '/serum/configs/:id/request-approval',
    {
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        params: ConfigIdParams,
        body: SerumConfigApprovalRequest,
        response: { 200: SerumConfigVersion },
      },
    },
    async (req) => {
      const row = await prisma.$transaction(async (tx) => {
        const draftForLock = await tx.serumConfigVersion.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        });
        if (!draftForLock) throw server.httpErrors.notFound('SERUM config version not found.');

        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${configLockKey(
            draftForLock.orgId,
            draftForLock.configType,
            draftForLock.configKey,
            draftForLock.environment,
          )}))
        `;

        const draft = await tx.serumConfigVersion.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        });
        if (!draft) throw server.httpErrors.notFound('SERUM config version not found.');
        if (draft.status !== 'draft') {
          throw server.httpErrors.badRequest('Only draft SERUM config versions can request approval.');
        }
        if (!configRequiresApproval(draft.configType)) {
          throw server.httpErrors.badRequest('This SERUM config section does not require high-risk approval.');
        }
        if (draft.approvalStatus === 'approved') {
          throw server.httpErrors.conflict('SERUM config draft is already approved.');
        }
        if (draft.approvalStatus === 'requested') {
          throw server.httpErrors.conflict(
            'SERUM config approval has already been requested; a different admin must approve it.',
          );
        }
        if (draft.approvalStatus !== 'required') {
          throw server.httpErrors.conflict('SERUM config draft is not waiting for approval request.');
        }

        const testResult = testSerumConfig({
          configType: draft.configType,
          configKey: draft.configKey,
          environment: draft.environment as SerumConfigEnvironmentValue,
          configJson: asJsonObject(draft.configJson),
        });
        if (testResult.status === 'fail') {
          throw server.httpErrors.conflict(
            'SERUM config approval request is blocked until deterministic config tests pass.',
          );
        }

        const requested = await tx.serumConfigVersion.update({
          where: { id: draft.id },
          data: {
            approvalStatus: 'requested',
            approvalRequestedAt: new Date(),
            approvalRequestedByUserId: req.auth.userId,
            approvalReference: draft.approvalReference ?? approvalReferenceFor(draft),
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'serum_config.approval.request',
            targetType: 'serum_config_version',
            targetId: requested.id,
            diff: {
              configType: requested.configType,
              configKey: requested.configKey,
              environment: requested.environment,
              version: requested.version,
              approvalStatus: requested.approvalStatus,
              approvalReference: requested.approvalReference,
              approvalRequestedByUserId: requested.approvalRequestedByUserId,
              approvalReason: req.body.approvalReason,
              configTestStatus: testResult.status,
            },
          },
        });
        return requested;
      });

      return serializeConfigVersion(row, req.auth.userId);
    },
  );

  server.post(
    '/serum/configs/:id/approve',
    {
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        params: ConfigIdParams,
        body: SerumConfigApprovalDecision,
        response: { 200: SerumConfigVersion },
      },
    },
    async (req) => {
      const row = await prisma.$transaction(async (tx) => {
        const draftForLock = await tx.serumConfigVersion.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        });
        if (!draftForLock) throw server.httpErrors.notFound('SERUM config version not found.');

        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${configLockKey(
            draftForLock.orgId,
            draftForLock.configType,
            draftForLock.configKey,
            draftForLock.environment,
          )}))
        `;

        const draft = await tx.serumConfigVersion.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        });
        if (!draft) throw server.httpErrors.notFound('SERUM config version not found.');
        if (draft.status !== 'draft') {
          throw server.httpErrors.badRequest('Only draft SERUM config versions can be approved.');
        }
        if (!configRequiresApproval(draft.configType)) {
          throw server.httpErrors.badRequest('This SERUM config section does not require high-risk approval.');
        }
        if (draft.approvalStatus !== 'requested') {
          throw server.httpErrors.conflict('SERUM config approval must be requested before it can be approved.');
        }
        if (!draft.approvalRequestedByUserId) {
          throw server.httpErrors.conflict('SERUM config approval requester is missing; request approval again.');
        }
        if (draft.approvalRequestedByUserId === req.auth.userId) {
          throw server.httpErrors.conflict(
            'High-risk SERUM config approval requires a different admin than the requester.',
          );
        }

        const testResult = testSerumConfig({
          configType: draft.configType,
          configKey: draft.configKey,
          environment: draft.environment as SerumConfigEnvironmentValue,
          configJson: asJsonObject(draft.configJson),
        });
        if (testResult.status === 'fail') {
          throw server.httpErrors.conflict(
            'SERUM config approval is blocked until deterministic config tests pass.',
          );
        }

        const approved = await tx.serumConfigVersion.update({
          where: { id: draft.id },
          data: {
            approvalStatus: 'approved',
            approvedByUserId: req.auth.userId,
            approvalApprovedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'serum_config.approval.approve',
            targetType: 'serum_config_version',
            targetId: approved.id,
            diff: {
              configType: approved.configType,
              configKey: approved.configKey,
              environment: approved.environment,
              version: approved.version,
              approvalStatus: approved.approvalStatus,
              approvalReference: approved.approvalReference,
              approvalRequestedByUserId: approved.approvalRequestedByUserId,
              approvedByUserId: approved.approvedByUserId,
              decisionNotes: req.body.decisionNotes,
              configTestStatus: testResult.status,
            },
          },
        });
        return approved;
      });

      return serializeConfigVersion(row, req.auth.userId);
    },
  );

  server.post(
    '/serum/configs/:id/publish',
    {
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        params: ConfigIdParams,
        body: SerumConfigPublishRequest,
        response: { 200: SerumConfigVersion },
      },
    },
    async (req) => {
      const row = await prisma.$transaction(async (tx) => {
        const draftForLock = await tx.serumConfigVersion.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        });
        if (!draftForLock) throw server.httpErrors.notFound('SERUM config version not found.');

        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${configLockKey(
            draftForLock.orgId,
            draftForLock.configType,
            draftForLock.configKey,
            draftForLock.environment,
          )}))
        `;

        const draft = await tx.serumConfigVersion.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        });
        if (!draft) throw server.httpErrors.notFound('SERUM config version not found.');
        if (draft.status !== 'draft') {
          throw server.httpErrors.badRequest('Only draft SERUM config versions can be published.');
        }
        const draftConfigType = SerumConfigType.parse(draft.configType);
        const requiresApproval = HIGH_RISK_CONFIG_TYPES.has(draftConfigType);
        if (requiresApproval) {
          if (
            draft.approvalStatus !== 'approved' ||
            !draft.approvalRequestedByUserId ||
            !draft.approvedByUserId ||
            !draft.approvalApprovedAt ||
            !draft.approvalReference ||
            draft.approvedByUserId === draft.approvalRequestedByUserId
          ) {
            throw server.httpErrors.conflict(
              'High-risk SERUM config drafts must be requested and approved by separate admins before publish.',
            );
          }
          const testResult = testSerumConfig({
            configType: draftConfigType,
            configKey: draft.configKey,
            environment: draft.environment as SerumConfigEnvironmentValue,
            configJson: asJsonObject(draft.configJson),
          });
          if (testResult.status === 'fail') {
            throw server.httpErrors.conflict(
              'High-risk SERUM config publish is blocked until deterministic config tests pass.',
            );
          }
        }
        await tx.serumConfigVersion.updateMany({
          where: {
            orgId: draft.orgId,
            configType: draft.configType,
            configKey: draft.configKey,
            environment: draft.environment,
            status: 'active',
            deletedAt: null,
            NOT: { id: draft.id },
          },
          data: { status: 'archived' },
        });
        const published = await tx.serumConfigVersion.update({
          where: { id: draft.id },
          data: {
            status: 'active',
            approvedByUserId: requiresApproval ? draft.approvedByUserId : req.auth.userId,
            activatedAt: new Date(),
            changeReason: req.body.changeReason ?? draft.changeReason,
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'serum_config.publish',
            targetType: 'serum_config_version',
            targetId: published.id,
            diff: {
              configType: published.configType,
              configKey: published.configKey,
              environment: published.environment,
              version: published.version,
              approvalStatus: published.approvalStatus,
              approvalReference: published.approvalReference,
              changeReason: published.changeReason,
            },
          },
        });
        return published;
      });

      return serializeConfigVersion(row, req.auth.userId);
    },
  );

  server.post(
    '/serum/configs/:id/rollback',
    {
      preHandler: [server.requirePermission('settings:write'), server.requireRole('admin')],
      schema: {
        params: ConfigIdParams,
        body: SerumConfigRollbackRequest,
        response: { 200: SerumConfigVersion },
      },
    },
    async (req) => {
      const row = await prisma.$transaction(async (tx) => {
        const target = await tx.serumConfigVersion.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        });
        if (!target) throw server.httpErrors.notFound('SERUM config version not found.');
        if (target.status === 'draft') {
          throw server.httpErrors.badRequest('Publish a draft before it can be used as a rollback target.');
        }

        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${configLockKey(
            target.orgId,
            target.configType,
            target.configKey,
            target.environment,
          )}))
        `;
        const version = await nextConfigVersion(
          tx,
          target.orgId,
          target.configType,
          target.configKey,
          target.environment,
        );
        await tx.serumConfigVersion.updateMany({
          where: {
            orgId: target.orgId,
            configType: target.configType,
            configKey: target.configKey,
            environment: target.environment,
            status: 'active',
            deletedAt: null,
          },
          data: { status: 'rolled_back' },
        });
        const rollbackApprovalRequired = configRequiresApproval(target.configType);
        const rollbackActivatedAt = new Date();
        const rollback = await tx.serumConfigVersion.create({
          data: {
            orgId: target.orgId,
            configType: target.configType,
            configKey: target.configKey,
            environment: target.environment,
            version,
            status: 'active',
            configJson: toInputJsonObject(target.configJson),
            createdByUserId: req.auth.userId,
            approvedByUserId: req.auth.userId,
            approvalStatus: rollbackApprovalRequired ? 'approved' : 'not_required',
            approvalApprovedAt: rollbackApprovalRequired ? rollbackActivatedAt : null,
            approvalReference: rollbackApprovalRequired
              ? target.approvalReference ?? approvalReferenceFor(target)
              : null,
            activatedAt: rollbackActivatedAt,
            rollbackOfConfigVersionId: target.id,
            changeReason: req.body.changeReason,
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'serum_config.rollback',
            targetType: 'serum_config_version',
            targetId: rollback.id,
            diff: {
              configType: rollback.configType,
              configKey: rollback.configKey,
              environment: rollback.environment,
              version: rollback.version,
              approvalStatus: rollback.approvalStatus,
              approvalReference: rollback.approvalReference,
              rollbackOfConfigVersionId: target.id,
              changeReason: rollback.changeReason,
            },
          },
        });
        return rollback;
      });

      return serializeConfigVersion(row, req.auth.userId);
    },
  );
};
