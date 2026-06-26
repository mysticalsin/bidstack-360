import { z } from 'zod';

export const SerumSignalStatus = z.enum([
  'ready',
  'active',
  'attention',
  'blocked',
  'disabled',
  'empty',
  'not_configured',
  'error',
]);
export type SerumSignalStatus = z.infer<typeof SerumSignalStatus>;

export const SerumStatusCard = z.object({
  id: z.string(),
  title: z.string(),
  value: z.string(),
  detail: z.string(),
  status: SerumSignalStatus,
  href: z.string().optional(),
});
export type SerumStatusCard = z.infer<typeof SerumStatusCard>;

export const SerumModuleStatus = z.object({
  id: z.string(),
  label: z.string(),
  status: SerumSignalStatus,
  detail: z.string(),
  primaryAction: z.string().optional(),
  href: z.string().optional(),
});
export type SerumModuleStatus = z.infer<typeof SerumModuleStatus>;

export const SerumProviderHealth = z.object({
  provider: z.string(),
  status: SerumSignalStatus,
  latencyMs: z.number().int().nonnegative().nullable(),
  lastCheckedAt: z.string().datetime().nullable(),
  message: z.string().nullable(),
});
export type SerumProviderHealth = z.infer<typeof SerumProviderHealth>;

export const SerumQueueHealth = z.object({
  queueName: z.string(),
  status: SerumSignalStatus,
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  lastCheckedAt: z.string().datetime().nullable(),
});
export type SerumQueueHealth = z.infer<typeof SerumQueueHealth>;

export const SerumBackendSignal = z.object({
  id: z.string(),
  label: z.string(),
  status: SerumSignalStatus,
  detail: z.string(),
});
export type SerumBackendSignal = z.infer<typeof SerumBackendSignal>;

export const SerumConfigType = z.enum([
  'general',
  'feature_flags',
  'agents',
  'loops',
  'model_router',
  'tools',
  'connectors',
  'knowledge_vault',
  'retrieval',
  'memory',
  'pattern_engine',
  'pricing_margin_rules',
  'rate_cards',
  'approvals',
  'permissions_policies',
  'prompt_library',
  'evals_quality_gates',
  'observability',
  'cost_budgets',
  'dust_mcp_gateway',
  'data_retention',
  'audit_log',
  'theme_ux',
  'safe_demo_mode',
]);
export type SerumConfigType = z.infer<typeof SerumConfigType>;

export const SerumConfigEnvironment = z.enum(['dev', 'staging', 'production']);
export type SerumConfigEnvironment = z.infer<typeof SerumConfigEnvironment>;

export const SerumConfigStatus = z.enum(['draft', 'active', 'archived', 'rolled_back']);
export type SerumConfigStatus = z.infer<typeof SerumConfigStatus>;

export const SerumConfigApprovalStatus = z.enum([
  'not_required',
  'required',
  'requested',
  'approved',
  'rejected',
]);
export type SerumConfigApprovalStatus = z.infer<typeof SerumConfigApprovalStatus>;

export const SerumConfigJson = z.record(z.unknown());
export type SerumConfigJson = z.infer<typeof SerumConfigJson>;

export const SerumConfigVersion = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  configType: SerumConfigType,
  configKey: z.string(),
  version: z.number().int().positive(),
  status: SerumConfigStatus,
  environment: SerumConfigEnvironment,
  configJson: SerumConfigJson,
  createdByUserId: z.string().uuid().nullable(),
  approvedByUserId: z.string().uuid().nullable(),
  approvalStatus: SerumConfigApprovalStatus,
  approvalRequestedAt: z.string().datetime().nullable(),
  approvalRequestedByUserId: z.string().uuid().nullable(),
  approvalRequestedByCurrentUser: z.boolean(),
  approvalApprovedAt: z.string().datetime().nullable(),
  approvalReference: z.string().nullable(),
  createdAt: z.string().datetime(),
  activatedAt: z.string().datetime().nullable(),
  rollbackOfConfigVersionId: z.string().uuid().nullable(),
  changeReason: z.string(),
});
export type SerumConfigVersion = z.infer<typeof SerumConfigVersion>;

export const SerumConfigAuditEntry = z.object({
  id: z.string(),
  action: z.string(),
  targetId: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable(),
  diff: z.unknown().nullable(),
  createdAt: z.string().datetime(),
});
export type SerumConfigAuditEntry = z.infer<typeof SerumConfigAuditEntry>;

export const SerumConfigSnapshot = z.object({
  active: SerumConfigVersion.nullable(),
  draft: SerumConfigVersion.nullable(),
  versions: z.array(SerumConfigVersion),
  auditTrail: z.array(SerumConfigAuditEntry),
});
export type SerumConfigSnapshot = z.infer<typeof SerumConfigSnapshot>;

export const SerumConfigDraftUpsert = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  configJson: SerumConfigJson,
  changeReason: z.string().trim().min(3).max(500),
});
export type SerumConfigDraftUpsert = z.infer<typeof SerumConfigDraftUpsert>;

export const SerumConfigPublishRequest = z.object({
  changeReason: z.string().trim().min(3).max(500).optional(),
});
export type SerumConfigPublishRequest = z.infer<typeof SerumConfigPublishRequest>;

export const SerumConfigApprovalRequest = z.object({
  approvalReason: z.string().trim().min(3).max(500),
});
export type SerumConfigApprovalRequest = z.infer<typeof SerumConfigApprovalRequest>;

export const SerumConfigApprovalDecision = z.object({
  decisionNotes: z.string().trim().min(3).max(500),
});
export type SerumConfigApprovalDecision = z.infer<typeof SerumConfigApprovalDecision>;

export const SerumConfigRollbackRequest = z.object({
  changeReason: z.string().trim().min(3).max(500),
});
export type SerumConfigRollbackRequest = z.infer<typeof SerumConfigRollbackRequest>;

export const SerumConfigTestStatus = z.enum(['pass', 'warn', 'fail']);
export type SerumConfigTestStatus = z.infer<typeof SerumConfigTestStatus>;

export const SerumConfigTestRequest = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  configJson: SerumConfigJson,
});
export type SerumConfigTestRequest = z.infer<typeof SerumConfigTestRequest>;

export const SerumConfigTestCheck = z.object({
  id: z.string(),
  label: z.string(),
  status: SerumConfigTestStatus,
  detail: z.string(),
});
export type SerumConfigTestCheck = z.infer<typeof SerumConfigTestCheck>;

export const SerumConfigTestResult = z.object({
  configType: SerumConfigType,
  configKey: z.string(),
  environment: SerumConfigEnvironment,
  checkedAt: z.string().datetime(),
  status: SerumConfigTestStatus,
  summary: z.string(),
  checks: z.array(SerumConfigTestCheck),
});
export type SerumConfigTestResult = z.infer<typeof SerumConfigTestResult>;

export const SerumRuntimeDecisionStatus = z.enum([
  'allowed',
  'denied',
  'disabled',
  'not_configured',
]);
export type SerumRuntimeDecisionStatus = z.infer<typeof SerumRuntimeDecisionStatus>;

export const SerumRuntimeDecision = z.object({
  configType: SerumConfigType,
  configKey: z.string(),
  environment: SerumConfigEnvironment,
  subject: z.string(),
  allowed: z.boolean(),
  status: SerumRuntimeDecisionStatus,
  reason: z.string(),
  activeConfigVersionId: z.string().uuid().nullable(),
});
export type SerumRuntimeDecision = z.infer<typeof SerumRuntimeDecision>;

export const SerumRuntimeAgentPolicy = z.object({
  activeConfigVersionId: z.string().uuid().nullable(),
  activeConfigVersion: z.number().int().positive().nullable(),
  enabled: z.boolean(),
  autonomy: z.string(),
  allowedAgentIds: z.array(z.string()),
  maxConcurrentRuns: z.number().int().nonnegative(),
  currentActiveRuns: z.number().int().nonnegative(),
  humanApprovalRequired: z.boolean(),
});
export type SerumRuntimeAgentPolicy = z.infer<typeof SerumRuntimeAgentPolicy>;

export const SerumRuntimeLoopPolicy = z.object({
  activeConfigVersionId: z.string().uuid().nullable(),
  activeConfigVersion: z.number().int().positive().nullable(),
  enabled: z.boolean(),
  durableEventsRequired: z.boolean(),
  stopOnApprovalGate: z.boolean(),
  replayMode: z.string(),
  maxRetries: z.number().int().nonnegative(),
});
export type SerumRuntimeLoopPolicy = z.infer<typeof SerumRuntimeLoopPolicy>;

export const SerumRuntimeToolPolicy = z.object({
  activeConfigVersionId: z.string().uuid().nullable(),
  activeConfigVersion: z.number().int().positive().nullable(),
  enabled: z.boolean(),
  registryMode: z.string(),
  allowedTools: z.array(z.string()),
  allowWriteTools: z.boolean(),
  requireDryRunForWriteTools: z.boolean(),
});
export type SerumRuntimeToolPolicy = z.infer<typeof SerumRuntimeToolPolicy>;

export const SerumRuntimeConnectorPolicy = z.object({
  activeConfigVersionId: z.string().uuid().nullable(),
  activeConfigVersion: z.number().int().positive().nullable(),
  enabled: z.boolean(),
  connectorMode: z.string(),
  requireConnectionTest: z.boolean(),
  secretRefs: z.array(z.string()),
});
export type SerumRuntimeConnectorPolicy = z.infer<typeof SerumRuntimeConnectorPolicy>;

export const SerumRuntimeModelRouterPolicy = z.object({
  activeConfigVersionId: z.string().uuid().nullable(),
  activeConfigVersion: z.number().int().positive().nullable(),
  defaultProvider: z.string().nullable(),
  fallbackProvider: z.string().nullable(),
  effectiveProvider: z.string().nullable(),
  providerConfigured: z.boolean(),
  maxTokensPerRequest: z.number().int().positive(),
  requireSourceCitations: z.boolean(),
  uncertaintyMode: z.string(),
});
export type SerumRuntimeModelRouterPolicy = z.infer<typeof SerumRuntimeModelRouterPolicy>;

export const SerumRuntimeDustMcpGatewayPolicy = z.object({
  activeConfigVersionId: z.string().uuid().nullable(),
  activeConfigVersion: z.number().int().positive().nullable(),
  dustEnabled: z.boolean(),
  mcpEnabled: z.boolean(),
  writeMode: z.string(),
  secretRefs: z.array(z.string()),
  requireToolAudit: z.boolean(),
});
export type SerumRuntimeDustMcpGatewayPolicy = z.infer<
  typeof SerumRuntimeDustMcpGatewayPolicy
>;

export const SerumRuntimeRetrievalPolicy = z.object({
  activeConfigVersionId: z.string().uuid().nullable(),
  activeConfigVersion: z.number().int().positive().nullable(),
  enabled: z.boolean(),
  requireGroundedSources: z.boolean(),
  minimumConfidence: z.number().min(0).max(1),
  maxChunks: z.number().int().positive(),
  noSourceBehavior: z.string(),
});
export type SerumRuntimeRetrievalPolicy = z.infer<typeof SerumRuntimeRetrievalPolicy>;

export const SerumRuntimePromptLibraryPolicy = z.object({
  activeConfigVersionId: z.string().uuid().nullable(),
  activeConfigVersion: z.number().int().positive().nullable(),
  versionedPromptsRequired: z.boolean(),
  promptInjectionTestsRequired: z.boolean(),
  approvalRequiredForProduction: z.boolean(),
  allowedPromptSets: z.array(z.string()),
});
export type SerumRuntimePromptLibraryPolicy = z.infer<
  typeof SerumRuntimePromptLibraryPolicy
>;

export const SerumRuntimeEvalsQualityGatePolicy = z.object({
  activeConfigVersionId: z.string().uuid().nullable(),
  activeConfigVersion: z.number().int().positive().nullable(),
  requiredBeforePublish: z.boolean(),
  minimumPassRate: z.number().min(0).max(1),
  regressionSuites: z.array(z.string()),
  blockOnFailure: z.boolean(),
});
export type SerumRuntimeEvalsQualityGatePolicy = z.infer<
  typeof SerumRuntimeEvalsQualityGatePolicy
>;

export const SerumRuntimePolicy = z.object({
  generatedAt: z.string().datetime(),
  environment: SerumConfigEnvironment,
  agents: SerumRuntimeAgentPolicy,
  loops: SerumRuntimeLoopPolicy,
  tools: SerumRuntimeToolPolicy,
  connectors: SerumRuntimeConnectorPolicy,
  modelRouter: SerumRuntimeModelRouterPolicy,
  dustMcpGateway: SerumRuntimeDustMcpGatewayPolicy,
  retrieval: SerumRuntimeRetrievalPolicy,
  promptLibrary: SerumRuntimePromptLibraryPolicy,
  evalsQualityGates: SerumRuntimeEvalsQualityGatePolicy,
});
export type SerumRuntimePolicy = z.infer<typeof SerumRuntimePolicy>;

export const SerumRuntimeAgentCheckRequest = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  agentId: z.string().trim().min(1).max(100),
  approvalConfirmed: z.boolean().default(false),
});
export type SerumRuntimeAgentCheckRequest = z.infer<typeof SerumRuntimeAgentCheckRequest>;

export const SerumRuntimeLoopCheckRequest = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  loopId: z.string().trim().min(1).max(160),
  operation: z.string().trim().min(1).max(120),
  retryCount: z.number().int().nonnegative().max(100).default(0),
  hasDurableEvent: z.boolean().default(true),
  approvalGateReached: z.boolean().default(false),
  replayRequested: z.boolean().default(false),
  approvalConfirmed: z.boolean().default(false),
});
export type SerumRuntimeLoopCheckRequest = z.infer<typeof SerumRuntimeLoopCheckRequest>;

export const SerumRuntimeToolCheckRequest = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  toolName: z.string().trim().min(1).max(120),
  dryRun: z.boolean().default(true),
});
export type SerumRuntimeToolCheckRequest = z.infer<typeof SerumRuntimeToolCheckRequest>;

export const SerumRuntimeConnectorCheckRequest = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  connectorId: z.string().trim().min(1).max(120),
  operation: z.string().trim().min(1).max(120),
  writeRequested: z.boolean().default(false),
  approvalConfirmed: z.boolean().default(false),
});
export type SerumRuntimeConnectorCheckRequest = z.infer<
  typeof SerumRuntimeConnectorCheckRequest
>;

export const SerumRuntimeModelRouterCheckRequest = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  provider: z.string().trim().min(1).max(80).optional(),
  requestedMaxTokens: z.number().int().positive().max(64_000).default(1000),
  sourceCitationsRequired: z.boolean().default(true),
});
export type SerumRuntimeModelRouterCheckRequest = z.infer<
  typeof SerumRuntimeModelRouterCheckRequest
>;

export const SerumRuntimeDustMcpGatewayCheckRequest = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  operation: z.string().trim().min(1).max(120),
  writeRequested: z.boolean().default(false),
  approvalConfirmed: z.boolean().default(false),
  toolAuditPresent: z.boolean().default(true),
});
export type SerumRuntimeDustMcpGatewayCheckRequest = z.infer<
  typeof SerumRuntimeDustMcpGatewayCheckRequest
>;

export const SerumRuntimeRetrievalCheckRequest = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  operation: z.string().trim().min(1).max(120),
  requestedChunks: z.number().int().positive().max(100).default(1),
  sourceBacked: z.boolean().default(true),
  expectedConfidence: z.number().min(0).max(1).default(1),
});
export type SerumRuntimeRetrievalCheckRequest = z.infer<
  typeof SerumRuntimeRetrievalCheckRequest
>;

export const SerumRuntimePromptLibraryCheckRequest = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  operation: z.string().trim().min(1).max(120),
  promptSet: z.string().trim().min(1).max(120),
  versionedPrompt: z.boolean().default(true),
  injectionTested: z.boolean().default(true),
  productionApproved: z.boolean().default(false),
});
export type SerumRuntimePromptLibraryCheckRequest = z.infer<
  typeof SerumRuntimePromptLibraryCheckRequest
>;

export const SerumRuntimeEvalsQualityGateCheckRequest = z.object({
  environment: SerumConfigEnvironment.default('dev'),
  operation: z.string().trim().min(1).max(120),
  suite: z.string().trim().min(1).max(120),
  passRate: z.number().min(0).max(1),
  failedCount: z.number().int().nonnegative(),
});
export type SerumRuntimeEvalsQualityGateCheckRequest = z.infer<
  typeof SerumRuntimeEvalsQualityGateCheckRequest
>;

export const SerumStatusSummary = z.object({
  activeAgents: z.number().int().nonnegative(),
  activeLoops: z.number().int().nonnegative(),
  documentsProcessedToday: z.number().int().nonnegative(),
  failedJobs: z.number().int().nonnegative(),
  openApprovals: z.number().int().nonnegative(),
  modelCallsToday: z.number().int().nonnegative(),
  modelTokensToday: z.number().int().nonnegative(),
  providerConfigured: z.boolean(),
  dustConfigured: z.boolean(),
  mcpConfigured: z.boolean(),
  latestConfigChangeAt: z.string().datetime().nullable(),
});
export type SerumStatusSummary = z.infer<typeof SerumStatusSummary>;

export const SerumStatusSnapshot = z.object({
  generatedAt: z.string().datetime(),
  environment: z.enum(['development', 'production', 'test']),
  enabled: z.boolean(),
  demoModeEnabled: z.boolean(),
  summary: SerumStatusSummary,
  cards: z.array(SerumStatusCard),
  modules: z.array(SerumModuleStatus),
  providerHealth: z.array(SerumProviderHealth),
  queueHealth: z.array(SerumQueueHealth),
  signalHealth: z.array(SerumBackendSignal),
  guardrails: z.array(z.string()),
});
export type SerumStatusSnapshot = z.infer<typeof SerumStatusSnapshot>;
