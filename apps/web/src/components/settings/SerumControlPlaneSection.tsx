import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type {
  SerumConfigAuditEntry,
  SerumConfigSnapshot,
  SerumConfigTestResult,
  SerumConfigTestStatus,
  SerumConfigType,
  SerumConfigVersion,
  SerumSignalStatus,
  SerumStatusSnapshot,
} from '@bidstack/shared';

import {
  SerumConfigVersionBadge,
  SerumEmptyState,
  SerumErrorState,
  SerumPanel,
  SerumSettingsRow,
  SerumSettingsSection,
  SerumStatusPill,
} from '@/components/serum/SerumGlass';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import {
  useApproveSerumConfigVersion,
  usePublishSerumConfigVersion,
  useRequestSerumConfigApproval,
  useRollbackSerumConfigVersion,
  useSaveSerumConfigDraft,
  useSerumConfig,
  useTestSerumConfig,
} from '@/hooks/useSerumConfig';
import { useSerumStatus } from '@/hooks/useSerumStatus';
import { cn } from '@/lib/cn';

interface SerumConfigSection {
  configType: SerumConfigType;
  configKey: string;
  label: string;
  summary: string;
  detail: (snapshot: SerumStatusSnapshot) => string;
  status: (snapshot: SerumStatusSnapshot) => SerumSignalStatus;
  defaultConfig: Record<string, unknown>;
  href?: string;
}

const HIGH_RISK_SERUM_CONFIG_TYPES = new Set<SerumConfigType>([
  'agents',
  'loops',
  'model_router',
  'tools',
  'connectors',
  'prompt_library',
  'evals_quality_gates',
  'dust_mcp_gateway',
]);

const SERUM_CONFIG_SECTIONS: SerumConfigSection[] = [
  {
    configType: 'general',
    configKey: 'deployment',
    label: 'General',
    summary: 'Safe deployment posture for action mode, memory, pricing, and event animation.',
    detail: (snapshot) => (snapshot.enabled ? 'SERUM deployment flag is enabled.' : 'SERUM_ENABLED is false.'),
    status: (snapshot) => (snapshot.enabled ? 'ready' : 'disabled'),
    defaultConfig: {
      safeMode: true,
      actionMode: 'read_only',
      eventAnimations: 'backend_events_only',
      memoryPromotion: 'approval_required',
      pricingMode: 'deterministic_tools_only',
    },
  },
  {
    configType: 'feature_flags',
    configKey: 'runtime',
    label: 'Feature Flags',
    summary: 'Runtime gates for safe rollout, demo mode, and kill-switch behavior.',
    detail: (snapshot) =>
      snapshot.demoModeEnabled ? 'Demo mode flag is on for this non-production environment.' : 'Demo mode flag is off.',
    status: (snapshot) => (snapshot.demoModeEnabled ? 'attention' : 'ready'),
    defaultConfig: {
      serumEnabled: false,
      demoMode: false,
      rollout: 'disabled',
      killSwitch: true,
      allowedTenantIds: [],
    },
  },
  {
    configType: 'agents',
    configKey: 'registry',
    label: 'Agents',
    summary: 'Agent registry posture, concurrency limits, and human approval requirements.',
    detail: (snapshot) => `${snapshot.summary.activeAgents} crew agent personas are configured.`,
    status: (snapshot) => (snapshot.summary.activeAgents > 0 ? 'ready' : 'empty'),
    href: '/agent-studio',
    defaultConfig: {
      enabled: false,
      autonomy: 'disabled',
      allowedAgentIds: [],
      maxConcurrentRuns: 0,
      humanApprovalRequired: true,
    },
  },
  {
    configType: 'loops',
    configKey: 'orchestration',
    label: 'Loops',
    summary: 'Durable loop controls for retries, replay, and approval boundaries.',
    detail: (snapshot) => `${snapshot.summary.activeLoops} Crew/RFP loops are currently active.`,
    status: (snapshot) => (snapshot.summary.activeLoops > 0 ? 'active' : 'ready'),
    defaultConfig: {
      enabled: false,
      durableEventsRequired: true,
      replayMode: 'manual_only',
      maxRetries: 1,
      stopOnApprovalGate: true,
    },
  },
  {
    configType: 'model_router',
    configKey: 'routing',
    label: 'Model Router',
    summary: 'Provider routing, fallback policy, token limits, and citation requirements.',
    detail: (snapshot) =>
      snapshot.summary.providerConfigured || snapshot.summary.dustConfigured
        ? 'Org provider or Dust fallback is configured.'
        : 'No org model provider or Dust fallback is configured.',
    status: (snapshot) =>
      snapshot.summary.providerConfigured || snapshot.summary.dustConfigured ? 'ready' : 'not_configured',
    href: '/settings?tab=integrations',
    defaultConfig: {
      defaultProvider: 'not_configured',
      fallbackProvider: null,
      secretRefs: [],
      maxTokensPerRequest: 4000,
      requireSourceCitations: true,
      uncertaintyMode: 'answer_with_limits',
    },
  },
  {
    configType: 'tools',
    configKey: 'registry',
    label: 'Tools',
    summary: 'Tool execution registry, write-action safety, and explicit allowlists.',
    detail: () => 'Registry-backed tool execution is not yet promoted for SERUM loops.',
    status: () => 'not_configured',
    defaultConfig: {
      enabled: false,
      registryMode: 'explicit_allowlist',
      allowedTools: [],
      allowWriteTools: false,
      requireDryRunForWriteTools: true,
    },
  },
  {
    configType: 'connectors',
    configKey: 'external-systems',
    label: 'Connectors',
    summary: 'External connector rollout, test-before-publish policy, and sync mode.',
    detail: (snapshot) =>
      snapshot.summary.dustConfigured ? 'Dust connector is configured.' : 'Dust connector is not configured.',
    status: (snapshot) => (snapshot.summary.dustConfigured ? 'ready' : 'not_configured'),
    href: '/settings?tab=integrations',
    defaultConfig: {
      enabled: false,
      connectorMode: 'read_only',
      requireConnectionTest: true,
      syncSchedule: 'manual',
      secretRefs: [],
    },
  },
  {
    configType: 'knowledge_vault',
    configKey: 'promotion',
    label: 'Knowledge Vault',
    summary: 'Knowledge promotion, PII handling, and review rules.',
    detail: () => 'RFP source chunks exist in the document pipeline; SERUM vault promotion is pending.',
    status: () => 'not_configured',
    defaultConfig: {
      promotionMode: 'manual_review',
      piiRedactionRequired: true,
      allowedSourceTypes: ['rfp_document', 'contract_agreement'],
      retentionDays: 365,
    },
  },
  {
    configType: 'retrieval',
    configKey: 'policy',
    label: 'Retrieval',
    summary: 'Retrieval limits, source requirements, and confidence thresholds.',
    detail: () => 'RFP pgvector retrieval exists; SERUM-wide retrieval policy is pending.',
    status: () => 'attention',
    defaultConfig: {
      enabled: false,
      requireGroundedSources: true,
      minimumConfidence: 0.72,
      maxChunks: 8,
      noSourceBehavior: 'say_uncertain',
    },
  },
  {
    configType: 'memory',
    configKey: 'promotion',
    label: 'Memory',
    summary: 'Memory promotion gates, decay, and human review policy.',
    detail: () => 'No auto-memory promotion is active.',
    status: () => 'not_configured',
    defaultConfig: {
      autoPromote: false,
      promotionMode: 'human_review',
      decayDays: 90,
      requireCustomerDataScrub: true,
    },
  },
  {
    configType: 'pattern_engine',
    configKey: 'insights',
    label: 'Pattern Engine',
    summary: 'Evidence-backed pattern mining and insight promotion thresholds.',
    detail: () => 'No evidence-backed pattern promotion workflow is active.',
    status: () => 'not_configured',
    defaultConfig: {
      enabled: false,
      minimumEvidenceCount: 5,
      requireSourceLinks: true,
      promotionMode: 'draft_only',
    },
  },
  {
    configType: 'pricing_margin_rules',
    configKey: 'deterministic-policy',
    label: 'Pricing/Margin Rules',
    summary: 'Deterministic pricing mode, margin floors, and model-assist boundaries.',
    detail: () => 'Use deterministic business rules before any model-assisted pricing.',
    status: () => 'not_configured',
    defaultConfig: {
      pricingMode: 'deterministic_only',
      modelMaySuggest: false,
      approvalRequiredBelowMarginPercent: 25,
      currency: 'EUR',
    },
  },
  {
    configType: 'rate_cards',
    configKey: 'governance',
    label: 'Rate Cards',
    summary: 'Rate-card validation, partner discounts, and override approval rules.',
    detail: () => 'Rate-card governance is not yet connected to SERUM.',
    status: () => 'not_configured',
    defaultConfig: {
      enabled: false,
      partnerDiscountApprovalRequired: true,
      manualOverrideRequiresReason: true,
      staleRateCardDays: 180,
    },
  },
  {
    configType: 'approvals',
    configKey: 'gates',
    label: 'Approvals',
    summary: 'Approval thresholds and human review requirements for risky actions.',
    detail: (snapshot) => `${snapshot.summary.openApprovals} approval gates are pending.`,
    status: (snapshot) => (snapshot.summary.openApprovals > 0 ? 'active' : 'ready'),
    defaultConfig: {
      requiredForLegal: true,
      requiredForPricingExceptions: true,
      requiredForExternalWrites: true,
      escalationAfterHours: 24,
    },
  },
  {
    configType: 'permissions_policies',
    configKey: 'rbac',
    label: 'Permissions & Policies',
    summary: 'RBAC policy, admin-write gates, and tenant isolation posture.',
    detail: () => 'Reads and writes are permission-gated; high-risk policies need section-specific approval rules.',
    status: () => 'attention',
    defaultConfig: {
      readPermission: 'settings:read',
      writePermission: 'settings:write',
      adminRoleRequired: true,
      tenantIsolationRequired: true,
    },
  },
  {
    configType: 'prompt_library',
    configKey: 'governance',
    label: 'Prompt Library',
    summary: 'Prompt versioning, injection tests, and approval requirements.',
    detail: () => 'Existing RFP templates remain source-controlled; versioned SERUM prompt config is pending.',
    status: () => 'not_configured',
    defaultConfig: {
      versionedPromptsRequired: true,
      promptInjectionTestsRequired: true,
      approvalRequiredForProduction: true,
      allowedPromptSets: [],
    },
  },
  {
    configType: 'evals_quality_gates',
    configKey: 'release',
    label: 'Evals',
    summary: 'Evaluation suites, pass thresholds, and release gate behavior.',
    detail: () => 'RFP eval fixtures exist; SERUM-specific eval suites are pending.',
    status: () => 'attention',
    defaultConfig: {
      requiredBeforePublish: true,
      minimumPassRate: 0.98,
      regressionSuites: ['rfp_grounding', 'prompt_injection'],
      blockOnFailure: true,
    },
  },
  {
    configType: 'observability',
    configKey: 'signals',
    label: 'Observability',
    summary: 'Provider, queue, cost, latency, and error signals for operators.',
    detail: (snapshot) =>
      `${snapshot.queueHealth.length} queue health rows and ${snapshot.providerHealth.length} provider health rows available.`,
    status: (snapshot) => (snapshot.summary.failedJobs > 0 ? 'attention' : 'ready'),
    defaultConfig: {
      enabled: true,
      providerHealthRequired: true,
      queueHealthRequired: true,
      alertOnFailedJobs: true,
      staleSignalMinutes: 10,
    },
  },
  {
    configType: 'cost_budgets',
    configKey: 'limits',
    label: 'Cost & Budgets',
    summary: 'Token, request, provider, and monthly spend budget controls.',
    detail: (snapshot) => `${snapshot.summary.modelTokensToday.toLocaleString('en-US')} model tokens recorded today.`,
    status: (snapshot) => (snapshot.summary.modelCallsToday > 0 ? 'active' : 'empty'),
    defaultConfig: {
      dailyTokenBudget: 0,
      monthlySpendBudgetMicros: 0,
      alertAtPercent: 80,
      blockAtPercent: 100,
    },
  },
  {
    configType: 'dust_mcp_gateway',
    configKey: 'gateway',
    label: 'Dust/MCP Gateway',
    summary: 'Dust and MCP gateway posture, write mode, and secret references.',
    detail: (snapshot) =>
      snapshot.summary.dustConfigured && snapshot.summary.mcpConfigured
        ? 'Dust credentials and MCP public URL are configured.'
        : 'Dust or MCP gateway is missing.',
    status: (snapshot) =>
      snapshot.summary.dustConfigured && snapshot.summary.mcpConfigured ? 'ready' : 'not_configured',
    href: '/settings?tab=integrations',
    defaultConfig: {
      dustEnabled: false,
      mcpEnabled: false,
      writeMode: 'draft_only',
      secretRefs: [],
      requireToolAudit: true,
    },
  },
  {
    configType: 'data_retention',
    configKey: 'policy',
    label: 'Data Retention',
    summary: 'Retention, deletion, and export rules for SERUM data.',
    detail: () => 'SERUM-specific retention policy tables are not yet created.',
    status: () => 'not_configured',
    defaultConfig: {
      retentionDays: 365,
      deleteMode: 'soft_delete',
      exportOnRequest: true,
      legalHoldOverridesDeletion: true,
    },
  },
  {
    configType: 'audit_log',
    configKey: 'policy',
    label: 'Audit Log',
    summary: 'Audit retention, export, and required event coverage.',
    detail: (snapshot) =>
      snapshot.summary.latestConfigChangeAt
        ? `Latest relevant config change: ${new Date(snapshot.summary.latestConfigChangeAt).toLocaleString()}.`
        : 'No relevant config changes recorded.',
    status: (snapshot) => (snapshot.summary.latestConfigChangeAt ? 'ready' : 'empty'),
    href: '/settings?tab=audit-log',
    defaultConfig: {
      retentionDays: 2555,
      exportEnabled: true,
      requireActor: true,
      requiredEventTypes: ['draft', 'publish', 'rollback'],
    },
  },
  {
    configType: 'theme_ux',
    configKey: 'experience',
    label: 'Theme & UX',
    summary: 'Motion, sound, theme, and accessibility posture for SERUM surfaces.',
    detail: () => 'SERUM Glass tokens are active; click sound remains controlled in Appearance settings.',
    status: () => 'ready',
    href: '/settings?tab=appearance',
    defaultConfig: {
      theme: 'system',
      motion: 'respect_reduced_motion',
      clickSound: 'user_setting',
      eventAnimations: 'backend_events_only',
    },
  },
  {
    configType: 'safe_demo_mode',
    configKey: 'policy',
    label: 'Safe/Demo Mode',
    summary: 'Demo mode boundaries and production fail-closed behavior.',
    detail: (snapshot) =>
      snapshot.demoModeEnabled
        ? 'Demo mode is explicitly enabled for this non-production environment.'
        : 'Demo mode is off.',
    status: (snapshot) => (snapshot.demoModeEnabled ? 'attention' : 'ready'),
    defaultConfig: {
      demoModeAllowedInProduction: false,
      fakeDataAllowed: false,
      simulatedAgentActivityAllowed: false,
      safeModeDefault: true,
    },
  },
];

const GENERAL_SECTION_ID = 'general:deployment';

export function SerumControlPlaneSection() {
  const status = useSerumStatus();
  const [selectedSectionId, setSelectedSectionId] = useState(GENERAL_SECTION_ID);
  const selectedSection = findSection(selectedSectionId);

  const refreshStatus = () => {
    void status.refetch();
  };

  if (status.isLoading) return <LoadingSkeleton rows={7} />;
  if (status.isError || !status.data) {
    return <SerumErrorState error={status.error} onRetry={() => void status.refetch()} />;
  }

  const snapshot = status.data;
  const validation = validateSnapshot(snapshot);

  return (
    <div className="space-y-5">
      <SerumPanel className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SerumStatusPill status={snapshot.enabled ? 'ready' : 'disabled'} />
              <SerumConfigVersionBadge label={`${SERUM_CONFIG_SECTIONS.length} governed sections`} />
            </div>
            <h3 className="mt-4 text-xl font-semibold tracking-tight text-[var(--fg-primary)]">
              SERUM Control Plane
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--fg-secondary)]">
              Current status is live from backend signals. Each section now uses the same versioned draft, publish, rollback, audit, and no-store config path.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={refreshStatus}
            disabled={status.isFetching}
          >
            <Icon name="refresh" size={14} ariaHidden />
            Test status
          </Button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusTile label="Environment" value={snapshot.environment} />
          <StatusTile label="SERUM enabled" value={snapshot.enabled ? 'true' : 'false'} />
          <StatusTile label="Demo mode" value={snapshot.demoModeEnabled ? 'true' : 'false'} />
          <StatusTile label="Generated" value={new Date(snapshot.generatedAt).toLocaleTimeString()} />
        </div>
      </SerumPanel>

      <SerumSettingsSection title="Validation" description="Readiness checks from the live status snapshot.">
        {validation.map((item) => (
          <SerumSettingsRow
            key={item.label}
            label={item.label}
            detail={item.detail}
            status={item.status}
          />
        ))}
      </SerumSettingsSection>

      <SerumSettingsSection title="Backend signals" description="Source availability from the live SERUM status read.">
        {snapshot.signalHealth.map((signal) => (
          <SerumSettingsRow
            key={signal.id}
            label={signal.label}
            detail={signal.detail}
            status={signal.status}
          />
        ))}
      </SerumSettingsSection>

      <SerumSettingsSection title="Configuration sections" description="Every SERUM section is selectable and backed by versioned config.">
        <div className="grid gap-2 py-1 sm:grid-cols-2 xl:grid-cols-3">
          {SERUM_CONFIG_SECTIONS.map((section) => (
            <SectionSelector
              key={sectionId(section)}
              section={section}
              snapshot={snapshot}
              selected={sectionId(section) === sectionId(selectedSection)}
              onSelect={() => setSelectedSectionId(sectionId(section))}
            />
          ))}
        </div>
      </SerumSettingsSection>

      <SerumConfigWorkbench
        key={sectionId(selectedSection)}
        section={selectedSection}
        statusSnapshot={snapshot}
        onTestStatus={refreshStatus}
      />

      <SerumPanel className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Permission gate</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--fg-secondary)]">
              Reads require settings:read. Draft, publish, rollback, approval request, and approval decision require settings:write plus admin role. High-risk sections must be requested and approved by separate admins before publish.
            </p>
          </div>
          <Badge tone="blue">Admin writes</Badge>
        </div>
      </SerumPanel>

      {!snapshot.enabled ? (
        <SerumEmptyState
          title="SERUM is disabled"
          detail="This is the safe default. Enable SERUM only after durable events, policies, approvals, and section-specific test gates are ready."
        />
      ) : null}
    </div>
  );
}

function SerumConfigWorkbench({
  section,
  statusSnapshot,
  onTestStatus,
}: {
  section: SerumConfigSection;
  statusSnapshot: SerumStatusSnapshot;
  onTestStatus: () => void;
}) {
  const configQuery = useSerumConfig(section.configType, section.configKey);
  const saveDraft = useSaveSerumConfigDraft(section.configType, section.configKey);
  const testConfig = useTestSerumConfig(section.configType, section.configKey);
  const requestApproval = useRequestSerumConfigApproval(section.configType, section.configKey);
  const approveDraft = useApproveSerumConfigVersion(section.configType, section.configKey);
  const publishDraft = usePublishSerumConfigVersion(section.configType, section.configKey);
  const rollbackConfig = useRollbackSerumConfigVersion(section.configType, section.configKey);
  const configSnapshot = configQuery.data ?? null;
  const draftVersion = configSnapshot?.draft ?? null;
  const activeVersion = configSnapshot?.active ?? null;
  const rollbackTarget = selectRollbackTarget(configSnapshot);
  const configBusy =
    saveDraft.isPending ||
    testConfig.isPending ||
    requestApproval.isPending ||
    approveDraft.isPending ||
    publishDraft.isPending ||
    rollbackConfig.isPending;
  const editorKey = draftVersion?.id ?? activeVersion?.id ?? `${sectionId(section)}:default`;
  const editorInitialConfig = draftVersion?.configJson ?? activeVersion?.configJson ?? section.defaultConfig;
  const editorInitialChangeReason = draftVersion
    ? `Publish ${section.label} draft v${draftVersion.version}`
    : activeVersion
      ? `Update ${section.label} from active v${activeVersion.version}`
      : `Create ${section.label} governed config`;

  const handleTest = async (configJson: Record<string, unknown>) => {
    try {
      const result = await testConfig.mutateAsync({
        environment: 'dev',
        configJson,
      });
      onTestStatus();
      void configQuery.refetch();
      if (result.status === 'pass') {
        toast.success(`${section.label} test passed`);
      } else if (result.status === 'warn') {
        toast.warning(`${section.label} test has warnings`, { description: result.summary });
      } else {
        toast.error(`${section.label} test failed`, { description: result.summary });
      }
    } catch {
      toast.error(`${section.label} test failed`);
    }
  };

  const handleSaveDraft = async (configJson: Record<string, unknown>, changeReason: string) => {
    try {
      const saved = await saveDraft.mutateAsync({
        environment: 'dev',
        configJson,
        changeReason,
      });
      toast.success(`${section.label} draft v${saved.version} saved`);
    } catch {
      toast.error(`${section.label} draft save failed`);
    }
  };

  const handleRequestApproval = async (approvalReason: string) => {
    if (!draftVersion) return;
    try {
      const requested = await requestApproval.mutateAsync({
        id: draftVersion.id,
        body: { approvalReason },
      });
      toast.success(`${section.label} approval requested`, {
        description: requested.approvalReference ?? undefined,
      });
      onTestStatus();
    } catch {
      toast.error(`${section.label} approval request failed`);
    }
  };

  const handleApprove = async (decisionNotes: string) => {
    if (!draftVersion) return;
    try {
      const approved = await approveDraft.mutateAsync({
        id: draftVersion.id,
        body: { decisionNotes },
      });
      toast.success(`${section.label} approved`, {
        description: approved.approvalReference ?? undefined,
      });
      onTestStatus();
    } catch {
      toast.error(`${section.label} approval failed`);
    }
  };

  const handlePublish = async (changeReason: string) => {
    if (!draftVersion) return;
    try {
      const published = await publishDraft.mutateAsync({
        id: draftVersion.id,
        body: { changeReason },
      });
      toast.success(`${section.label} published v${published.version}`);
      onTestStatus();
    } catch {
      toast.error(`${section.label} publish failed`);
    }
  };

  const handleRollback = async (changeReason: string) => {
    if (!rollbackTarget) return;
    try {
      const rolledBack = await rollbackConfig.mutateAsync({
        id: rollbackTarget.id,
        body: { changeReason: `Rollback ${section.label} to v${rollbackTarget.version}: ${changeReason}` },
      });
      toast.success(`${section.label} rolled back to v${rollbackTarget.version}`, {
        description: `New active version: v${rolledBack.version}`,
      });
      onTestStatus();
    } catch {
      toast.error(`${section.label} rollback failed`);
    }
  };

  if (configQuery.isError) {
    return <SerumErrorState error={configQuery.error} onRetry={() => void configQuery.refetch()} />;
  }

  return (
    <GenericConfigEditor
      key={editorKey}
      section={section}
      liveStatus={section.status(statusSnapshot)}
      liveDetail={section.detail(statusSnapshot)}
      initialConfig={editorInitialConfig}
      initialChangeReason={editorInitialChangeReason}
      snapshot={configSnapshot}
      auditTrail={configSnapshot?.auditTrail ?? []}
      isLoading={configQuery.isLoading}
      isTesting={configQuery.isFetching || testConfig.isPending}
      testResult={testConfig.data ?? null}
      rollbackTarget={rollbackTarget}
      disabled={configBusy}
      onTest={handleTest}
      onSaveDraft={handleSaveDraft}
      onRequestApproval={handleRequestApproval}
      onApprove={handleApprove}
      onPublish={handlePublish}
      onRollback={handleRollback}
    />
  );
}

function SectionSelector({
  section,
  snapshot,
  selected,
  onSelect,
}: {
  section: SerumConfigSection;
  snapshot: SerumStatusSnapshot;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'min-h-11 rounded-xl border p-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]',
        selected
          ? 'border-[var(--serum-blue)] bg-[var(--serum-surface-solid)] shadow-[var(--serum-shadow-sm)]'
          : 'border-[var(--serum-border)] bg-[var(--serum-surface-soft)] hover:border-[var(--border-strong)] hover:bg-[var(--serum-surface-solid)]',
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--fg-primary)]">{section.label}</span>
          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--fg-secondary)]">
            {section.detail(snapshot)}
          </span>
        </span>
        <SerumStatusPill status={section.status(snapshot)} />
      </span>
    </button>
  );
}

function GenericConfigEditor({
  section,
  liveStatus,
  liveDetail,
  initialConfig,
  initialChangeReason,
  snapshot,
  auditTrail,
  isLoading,
  isTesting,
  testResult,
  rollbackTarget,
  disabled,
  onTest,
  onSaveDraft,
  onRequestApproval,
  onApprove,
  onPublish,
  onRollback,
}: {
  section: SerumConfigSection;
  liveStatus: SerumSignalStatus;
  liveDetail: string;
  initialConfig: unknown;
  initialChangeReason: string;
  snapshot: SerumConfigSnapshot | null;
  auditTrail: SerumConfigAuditEntry[];
  isLoading: boolean;
  isTesting: boolean;
  testResult: SerumConfigTestResult | null;
  rollbackTarget: SerumConfigVersion | null;
  disabled: boolean;
  onTest: (configJson: Record<string, unknown>) => Promise<void>;
  onSaveDraft: (configJson: Record<string, unknown>, changeReason: string) => Promise<void>;
  onRequestApproval: (approvalReason: string) => Promise<void>;
  onApprove: (decisionNotes: string) => Promise<void>;
  onPublish: (changeReason: string) => Promise<void>;
  onRollback: (changeReason: string) => Promise<void>;
}) {
  const [configText, setConfigText] = useState(() => prettyJson(initialConfig));
  const [changeReason, setChangeReason] = useState(initialChangeReason);
  const active = snapshot?.active ?? null;
  const draft = snapshot?.draft ?? null;
  const versions = snapshot?.versions.slice(0, 5) ?? [];
  const parsedConfig = parseConfigJson(configText);
  const structuredConfig = parsedConfig.ok ? parsedConfig.value : null;
  const highRisk = isHighRiskSection(section);
  const approvalBlockedForRequester =
    highRisk && draft?.approvalStatus === 'requested' && draft.approvalRequestedByCurrentUser;

  const updateConfigField = (key: string, value: unknown) => {
    const current = parseConfigJson(configText);
    if (!current.ok) return;
    setConfigText(prettyJson({ ...current.value, [key]: value }));
  };

  const submitTest = () => {
    const parsed = parseConfigJson(configText);
    if (!parsed.ok) {
      toast.error('Config JSON is invalid', { description: parsed.message });
      return;
    }
    void onTest(parsed.value);
  };

  const submitSaveDraft = () => {
    if (!hasChangeReason(changeReason)) {
      toast.error('Change reason is required');
      return;
    }
    const parsed = parseConfigJson(configText);
    if (!parsed.ok) {
      toast.error('Config JSON is invalid', { description: parsed.message });
      return;
    }
    void onSaveDraft(parsed.value, changeReason);
  };

  const submitRequestApproval = () => {
    if (!draft) return;
    if (!hasChangeReason(changeReason)) {
      toast.error('Approval reason is required');
      return;
    }
    void onRequestApproval(changeReason);
  };

  const submitApprove = () => {
    if (!draft) return;
    if (approvalBlockedForRequester) {
      toast.error('Another admin must approve this draft');
      return;
    }
    if (!hasChangeReason(changeReason)) {
      toast.error('Decision notes are required');
      return;
    }
    void onApprove(changeReason);
  };

  const submitPublish = () => {
    if (!draft) return;
    if (!hasChangeReason(changeReason)) {
      toast.error('Change reason is required');
      return;
    }
    if (highRisk && draft.approvalStatus !== 'approved') {
      toast.error('Approval is required before publish');
      return;
    }
    void onPublish(changeReason);
  };

  const submitRollback = () => {
    if (!rollbackTarget) return;
    if (!hasChangeReason(changeReason)) {
      toast.error('Change reason is required');
      return;
    }
    void onRollback(changeReason);
  };

  return (
    <SerumPanel className="p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <SerumStatusPill status={active ? 'ready' : draft ? 'attention' : liveStatus} />
                <SerumConfigVersionBadge
                  label={active ? `Active v${active.version}` : draft ? `Draft v${draft.version}` : 'Unpublished'}
                />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-[var(--fg-primary)]">{section.label}</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--fg-secondary)]">{section.summary}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {section.href ? <InlineLink to={section.href}>Open related</InlineLink> : null}
              <Button variant="secondary" size="sm" onClick={submitTest} disabled={disabled || isTesting}>
                <Icon name="refresh" size={14} ariaHidden />
                Test
              </Button>
              <Button variant="secondary" size="sm" onClick={submitSaveDraft} disabled={disabled || isLoading}>
                Save draft
              </Button>
              {highRisk ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={submitRequestApproval}
                    disabled={disabled || !draft || draft.approvalStatus !== 'required'}
                  >
                    Request approval
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={submitApprove}
                    disabled={
                      disabled ||
                      !draft ||
                      draft.approvalStatus !== 'requested' ||
                      approvalBlockedForRequester
                    }
                  >
                    Approve
                  </Button>
                </>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={submitPublish}
                disabled={disabled || !draft || (highRisk && draft.approvalStatus !== 'approved')}
              >
                Publish
              </Button>
              <Button variant="ghost" size="sm" onClick={submitRollback} disabled={disabled || !rollbackTarget}>
                Rollback
              </Button>
            </div>
          </div>

          <StructuredConfigControls
            section={section}
            config={structuredConfig}
            disabled={disabled || isLoading}
            onUpdate={updateConfigField}
          />

          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                Config JSON
              </span>
              <textarea
                value={configText}
                onChange={(event) => setConfigText(event.currentTarget.value)}
                spellCheck={false}
                rows={11}
                className="mt-2 min-h-[260px] w-full resize-y rounded-xl border border-[var(--border-default)] bg-[var(--surface-input)] p-3 font-mono text-xs leading-5 text-[var(--fg-primary)] shadow-[var(--shadow-xs)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
              />
            </label>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                  Change reason
                </span>
                <textarea
                  value={changeReason}
                  onChange={(event) => setChangeReason(event.currentTarget.value)}
                  rows={6}
                  maxLength={500}
                  className="mt-2 min-h-[132px] w-full resize-y rounded-xl border border-[var(--border-default)] bg-[var(--surface-input)] p-3 text-sm leading-6 text-[var(--fg-primary)] shadow-[var(--shadow-xs)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                />
              </label>
              <ValidationTile label="Current status" detail={liveDetail} status={liveStatus} />
              <ValidationTile
                label="Secret policy"
                detail="Raw API keys, passwords, credentials, and secrets are rejected server-side. Use secretRef fields."
                status="ready"
              />
              {highRisk ? <ApprovalGatePanel version={draft} /> : null}
              {testResult ? <TestResultPanel result={testResult} /> : null}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <HistoryPanel title="Versions" emptyDetail="No versions saved yet.">
            {versions.map((version) => (
              <div
                key={version.id}
                className="rounded-lg border border-[var(--serum-border)] bg-[var(--serum-surface-solid)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--fg-primary)]">v{version.version}</span>
                  <SerumStatusPill status={statusForConfigVersion(version)} />
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--fg-secondary)]">
                  {version.changeReason}
                </p>
                <p className="mt-2 text-[11px] text-[var(--fg-tertiary)]">
                  {new Date(version.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </HistoryPanel>

          <HistoryPanel title="Audit history" emptyDetail="No audit events for this section yet.">
            {auditTrail.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-[var(--serum-border)] bg-[var(--serum-surface-solid)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-[var(--fg-primary)]">
                    {auditLabel(entry.action)}
                  </span>
                  <span className="text-[11px] text-[var(--fg-tertiary)]">#{entry.id}</span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-[var(--fg-secondary)]">
                  {new Date(entry.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </HistoryPanel>
        </aside>
      </div>
    </SerumPanel>
  );
}

function HistoryPanel({
  title,
  emptyDetail,
  children,
}: {
  title: string;
  emptyDetail: string;
  children: ReactNode[];
}) {
  return (
    <div className="rounded-xl border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{title}</p>
          <h4 className="mt-1 text-sm font-semibold text-[var(--fg-primary)]">Inspector</h4>
        </div>
        <Icon name="shield" size={17} className="text-[var(--serum-blue)]" ariaHidden />
      </div>
      <div className="mt-4 space-y-3">
        {children.length === 0 ? (
          <p className="text-sm leading-6 text-[var(--fg-secondary)]">{emptyDetail}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function ValidationTile({
  label,
  detail,
  status,
}: {
  label: string;
  detail: string;
  status: SerumSignalStatus;
}) {
  return (
    <div className="rounded-xl border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{label}</p>
        <SerumStatusPill status={status} />
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--fg-secondary)]">{detail}</p>
    </div>
  );
}

function ApprovalGatePanel({ version }: { version: SerumConfigVersion | null }) {
  if (!version) {
    return (
      <ValidationTile
        label="Approval gate"
        detail="Save a draft before requesting approval for this high-risk section."
        status="attention"
      />
    );
  }

  const detail =
    version.approvalStatus === 'approved'
      ? `Approved ${formatNullableDate(version.approvalApprovedAt)}${version.approvalReference ? ` - ${version.approvalReference}` : ''}.`
      : version.approvalStatus === 'requested'
        ? `Requested ${formatNullableDate(version.approvalRequestedAt)}${version.approvalReference ? ` - ${version.approvalReference}` : ''}. ${
            version.approvalRequestedByCurrentUser
              ? 'Another admin must approve this draft.'
              : 'You can approve after reviewing the deterministic test evidence.'
          }`
        : version.approvalStatus === 'required'
          ? 'Approval is required before this draft can be published.'
          : version.approvalStatus === 'rejected'
            ? 'Approval was rejected; save a revised draft before publishing.'
            : 'Approval is not required for this section.';

  return (
    <ValidationTile
      label="Approval gate"
      detail={detail}
      status={statusForApprovalStatus(version.approvalStatus)}
    />
  );
}

function TestResultPanel({ result }: { result: SerumConfigTestResult }) {
  return (
    <div
      role="region"
      aria-label="Config test results"
      className="rounded-xl border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">Config test</p>
        <SerumStatusPill status={statusForTestStatus(result.status)} />
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--fg-secondary)]">{result.summary}</p>
      <div className="mt-3 space-y-2">
        {result.checks.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-[var(--serum-border)] bg-[var(--serum-surface-solid)] p-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <SerumStatusPill status={statusForTestStatus(item.status)} />
              <span className="text-xs font-semibold text-[var(--fg-primary)]">{item.label}</span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[var(--fg-secondary)]">{item.detail}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-[var(--fg-tertiary)]">
        Checked {new Date(result.checkedAt).toLocaleString()}
      </p>
    </div>
  );
}

function StructuredConfigControls({
  section,
  config,
  disabled,
  onUpdate,
}: {
  section: SerumConfigSection;
  config: Record<string, unknown> | null;
  disabled: boolean;
  onUpdate: (key: string, value: unknown) => void;
}) {
  const controlSet = getStructuredControlSet(section);
  if (!controlSet) return null;

  return (
    <div className="mt-5 rounded-xl border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
            Operator controls
          </p>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--fg-secondary)]">
            {controlSet.summary}
          </p>
        </div>
        <SerumConfigVersionBadge label="High-risk" />
      </div>

      {!config ? (
        <p className="mt-4 rounded-lg border border-[var(--serum-border)] bg-[var(--serum-surface-solid)] p-3 text-sm leading-6 text-[var(--fg-secondary)]">
          Structured controls are paused until the JSON is valid.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {renderStructuredFields(controlSet.kind, config, disabled, onUpdate)}
        </div>
      )}
    </div>
  );
}

type StructuredControlKind =
  | 'agents'
  | 'loops'
  | 'model_router'
  | 'tools'
  | 'connectors'
  | 'prompt_library'
  | 'evals_quality_gates'
  | 'dust_mcp_gateway';

function getStructuredControlSet(section: SerumConfigSection):
  | { kind: StructuredControlKind; summary: string }
  | null {
  if (section.configType === 'agents') {
    return {
      kind: 'agents',
      summary: 'Autonomy, concurrency, allowlist, and human approval settings for agent runs.',
    };
  }
  if (section.configType === 'loops') {
    return {
      kind: 'loops',
      summary: 'Durability, replay, retry, and approval-stop controls for orchestration loops.',
    };
  }
  if (section.configType === 'model_router') {
    return {
      kind: 'model_router',
      summary: 'Provider routing, secret references, token ceilings, and grounded-answer behavior.',
    };
  }
  if (section.configType === 'tools') {
    return {
      kind: 'tools',
      summary: 'Execution allowlists and write-action dry-run rules for tool use.',
    };
  }
  if (section.configType === 'connectors') {
    return {
      kind: 'connectors',
      summary: 'External-system rollout, connection testing, sync mode, and secret references.',
    };
  }
  if (section.configType === 'prompt_library') {
    return {
      kind: 'prompt_library',
      summary: 'Prompt versioning, injection-test coverage, and production approval gates.',
    };
  }
  if (section.configType === 'evals_quality_gates') {
    return {
      kind: 'evals_quality_gates',
      summary: 'Release eval requirements, regression suites, pass threshold, and fail-closed behavior.',
    };
  }
  if (section.configType === 'dust_mcp_gateway') {
    return {
      kind: 'dust_mcp_gateway',
      summary: 'Dust, MCP, write mode, tool audit, and gateway secret reference controls.',
    };
  }
  return null;
}

function renderStructuredFields(
  kind: StructuredControlKind,
  config: Record<string, unknown>,
  disabled: boolean,
  onUpdate: (key: string, value: unknown) => void,
): ReactNode[] {
  if (kind === 'agents') {
    return [
      <SwitchControl
        key="enabled"
        label="Enabled"
        checked={readBoolean(config, 'enabled', false)}
        disabled={disabled}
        onChange={(value) => onUpdate('enabled', value)}
      />,
      <SelectControl
        key="autonomy"
        label="Autonomy"
        value={readString(config, 'autonomy', 'disabled')}
        disabled={disabled}
        options={[
          ['disabled', 'Disabled'],
          ['assistive', 'Assistive'],
          ['supervised', 'Supervised'],
          ['autonomous', 'Autonomous'],
        ]}
        onChange={(value) => onUpdate('autonomy', value)}
      />,
      <NumberControl
        key="maxConcurrentRuns"
        label="Max concurrent runs"
        value={readNumber(config, 'maxConcurrentRuns', 0)}
        min={0}
        max={10}
        step={1}
        disabled={disabled}
        onChange={(value) => onUpdate('maxConcurrentRuns', value)}
      />,
      <SwitchControl
        key="humanApprovalRequired"
        label="Human approval"
        checked={readBoolean(config, 'humanApprovalRequired', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('humanApprovalRequired', value)}
      />,
      <StringArrayControl
        key="allowedAgentIds"
        label="Allowed agents"
        value={readStringArray(config, 'allowedAgentIds')}
        placeholder="agent-rfp, agent-pricing"
        disabled={disabled}
        onChange={(value) => onUpdate('allowedAgentIds', value)}
      />,
    ];
  }

  if (kind === 'loops') {
    return [
      <SwitchControl
        key="enabled"
        label="Enabled"
        checked={readBoolean(config, 'enabled', false)}
        disabled={disabled}
        onChange={(value) => onUpdate('enabled', value)}
      />,
      <SwitchControl
        key="durableEventsRequired"
        label="Durable events"
        checked={readBoolean(config, 'durableEventsRequired', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('durableEventsRequired', value)}
      />,
      <SwitchControl
        key="stopOnApprovalGate"
        label="Stop on approval"
        checked={readBoolean(config, 'stopOnApprovalGate', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('stopOnApprovalGate', value)}
      />,
      <SelectControl
        key="replayMode"
        label="Replay mode"
        value={readString(config, 'replayMode', 'manual_only')}
        disabled={disabled}
        options={[
          ['disabled', 'Disabled'],
          ['manual_only', 'Manual only'],
          ['approval_required', 'Approval required'],
        ]}
        onChange={(value) => onUpdate('replayMode', value)}
      />,
      <NumberControl
        key="maxRetries"
        label="Max retries"
        value={readNumber(config, 'maxRetries', 1)}
        min={0}
        max={5}
        step={1}
        disabled={disabled}
        onChange={(value) => onUpdate('maxRetries', value)}
      />,
    ];
  }

  if (kind === 'model_router') {
    return [
      <TextControl
        key="defaultProvider"
        label="Default provider"
        value={readString(config, 'defaultProvider', 'not_configured')}
        disabled={disabled}
        onChange={(value) => onUpdate('defaultProvider', value)}
      />,
      <TextControl
        key="fallbackProvider"
        label="Fallback provider"
        value={readNullableString(config, 'fallbackProvider')}
        disabled={disabled}
        onChange={(value) => onUpdate('fallbackProvider', value.trim() ? value : null)}
      />,
      <StringArrayControl
        key="secretRefs"
        label="Secret refs"
        value={readStringArray(config, 'secretRefs')}
        placeholder="openai-prod, dust-prod"
        disabled={disabled}
        onChange={(value) => onUpdate('secretRefs', value)}
      />,
      <NumberControl
        key="maxTokensPerRequest"
        label="Max tokens per request"
        value={readNumber(config, 'maxTokensPerRequest', 4000)}
        min={256}
        max={32000}
        step={256}
        disabled={disabled}
        onChange={(value) => onUpdate('maxTokensPerRequest', value)}
      />,
      <SwitchControl
        key="requireSourceCitations"
        label="Source citations"
        checked={readBoolean(config, 'requireSourceCitations', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('requireSourceCitations', value)}
      />,
      <SelectControl
        key="uncertaintyMode"
        label="Uncertainty mode"
        value={readString(config, 'uncertaintyMode', 'answer_with_limits')}
        disabled={disabled}
        options={[
          ['answer_with_limits', 'Answer with limits'],
          ['ask_for_clarification', 'Ask for clarification'],
          ['refuse_without_sources', 'Refuse without sources'],
        ]}
        onChange={(value) => onUpdate('uncertaintyMode', value)}
      />,
    ];
  }

  if (kind === 'tools') {
    return [
      <SwitchControl
        key="enabled"
        label="Enabled"
        checked={readBoolean(config, 'enabled', false)}
        disabled={disabled}
        onChange={(value) => onUpdate('enabled', value)}
      />,
      <SelectControl
        key="registryMode"
        label="Registry mode"
        value={readString(config, 'registryMode', 'explicit_allowlist')}
        disabled={disabled}
        options={[
          ['disabled', 'Disabled'],
          ['explicit_allowlist', 'Explicit allowlist'],
          ['reviewed_registry', 'Reviewed registry'],
        ]}
        onChange={(value) => onUpdate('registryMode', value)}
      />,
      <StringArrayControl
        key="allowedTools"
        label="Allowed tools"
        value={readStringArray(config, 'allowedTools')}
        placeholder="crm.read, rfp.draft"
        disabled={disabled}
        onChange={(value) => onUpdate('allowedTools', value)}
      />,
      <SwitchControl
        key="allowWriteTools"
        label="Write tools"
        checked={readBoolean(config, 'allowWriteTools', false)}
        disabled={disabled}
        onChange={(value) => onUpdate('allowWriteTools', value)}
      />,
      <SwitchControl
        key="requireDryRunForWriteTools"
        label="Dry run for writes"
        checked={readBoolean(config, 'requireDryRunForWriteTools', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('requireDryRunForWriteTools', value)}
      />,
    ];
  }

  if (kind === 'connectors') {
    return [
      <SwitchControl
        key="enabled"
        label="Enabled"
        checked={readBoolean(config, 'enabled', false)}
        disabled={disabled}
        onChange={(value) => onUpdate('enabled', value)}
      />,
      <SelectControl
        key="connectorMode"
        label="Connector mode"
        value={readString(config, 'connectorMode', 'read_only')}
        disabled={disabled}
        options={[
          ['disabled', 'Disabled'],
          ['read_only', 'Read only'],
          ['draft_write', 'Draft write'],
          ['approved_write', 'Approved write'],
        ]}
        onChange={(value) => onUpdate('connectorMode', value)}
      />,
      <SwitchControl
        key="requireConnectionTest"
        label="Connection test"
        checked={readBoolean(config, 'requireConnectionTest', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('requireConnectionTest', value)}
      />,
      <SelectControl
        key="syncSchedule"
        label="Sync schedule"
        value={readString(config, 'syncSchedule', 'manual')}
        disabled={disabled}
        options={[
          ['manual', 'Manual'],
          ['hourly', 'Hourly'],
          ['daily', 'Daily'],
        ]}
        onChange={(value) => onUpdate('syncSchedule', value)}
      />,
      <StringArrayControl
        key="secretRefs"
        label="Secret refs"
        value={readStringArray(config, 'secretRefs')}
        placeholder="salesforce-prod, graph-prod"
        disabled={disabled}
        onChange={(value) => onUpdate('secretRefs', value)}
      />,
    ];
  }

  if (kind === 'prompt_library') {
    return [
      <SwitchControl
        key="versionedPromptsRequired"
        label="Versioned prompts"
        checked={readBoolean(config, 'versionedPromptsRequired', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('versionedPromptsRequired', value)}
      />,
      <SwitchControl
        key="promptInjectionTestsRequired"
        label="Injection tests"
        checked={readBoolean(config, 'promptInjectionTestsRequired', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('promptInjectionTestsRequired', value)}
      />,
      <SwitchControl
        key="approvalRequiredForProduction"
        label="Production approval"
        checked={readBoolean(config, 'approvalRequiredForProduction', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('approvalRequiredForProduction', value)}
      />,
      <StringArrayControl
        key="allowedPromptSets"
        label="Allowed prompt sets"
        value={readStringArray(config, 'allowedPromptSets')}
        placeholder="rfp-response, account-intel"
        disabled={disabled}
        onChange={(value) => onUpdate('allowedPromptSets', value)}
      />,
    ];
  }

  if (kind === 'evals_quality_gates') {
    return [
      <SwitchControl
        key="requiredBeforePublish"
        label="Required before publish"
        checked={readBoolean(config, 'requiredBeforePublish', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('requiredBeforePublish', value)}
      />,
      <NumberControl
        key="minimumPassRate"
        label="Minimum pass rate"
        value={readNumber(config, 'minimumPassRate', 0.98)}
        min={0}
        max={1}
        step={0.01}
        disabled={disabled}
        onChange={(value) => onUpdate('minimumPassRate', value)}
      />,
      <StringArrayControl
        key="regressionSuites"
        label="Regression suites"
        value={readStringArray(config, 'regressionSuites')}
        placeholder="rfp_grounding, prompt_injection"
        disabled={disabled}
        onChange={(value) => onUpdate('regressionSuites', value)}
      />,
      <SwitchControl
        key="blockOnFailure"
        label="Block on failure"
        checked={readBoolean(config, 'blockOnFailure', true)}
        disabled={disabled}
        onChange={(value) => onUpdate('blockOnFailure', value)}
      />,
    ];
  }

  return [
    <SwitchControl
      key="dustEnabled"
      label="Dust enabled"
      checked={readBoolean(config, 'dustEnabled', false)}
      disabled={disabled}
      onChange={(value) => onUpdate('dustEnabled', value)}
    />,
    <SwitchControl
      key="mcpEnabled"
      label="MCP enabled"
      checked={readBoolean(config, 'mcpEnabled', false)}
      disabled={disabled}
      onChange={(value) => onUpdate('mcpEnabled', value)}
    />,
    <SelectControl
      key="writeMode"
      label="Write mode"
      value={readString(config, 'writeMode', 'draft_only')}
      disabled={disabled}
      options={[
        ['disabled', 'Disabled'],
        ['draft_only', 'Draft only'],
        ['approval_required', 'Approval required'],
      ]}
      onChange={(value) => onUpdate('writeMode', value)}
    />,
    <SwitchControl
      key="requireToolAudit"
      label="Tool audit"
      checked={readBoolean(config, 'requireToolAudit', true)}
      disabled={disabled}
      onChange={(value) => onUpdate('requireToolAudit', value)}
    />,
    <StringArrayControl
      key="secretRefs"
      label="Secret refs"
      value={readStringArray(config, 'secretRefs')}
      placeholder="dust-prod, mcp-gateway"
      disabled={disabled}
      onChange={(value) => onUpdate('secretRefs', value)}
    />,
  ];
}

function SwitchControl({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-left transition-colors',
        'hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <span className="min-w-0 text-sm font-medium text-[var(--fg-primary)]">{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked
            ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]'
            : 'border-[var(--border-default)] bg-[var(--surface-sunken)]',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-[var(--shadow-xs)] transition-transform',
            checked ? 'translate-x-5' : 'translate-x-1',
          )}
        />
      </span>
    </button>
  );
}

function TextControl({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      size="sm"
      label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      size="sm"
      type="number"
      label={label}
      value={Number.isFinite(value) ? String(value) : ''}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => {
        const nextValue = Number(event.currentTarget.value);
        onChange(Number.isFinite(nextValue) ? nextValue : min);
      }}
    />
  );
}

function SelectControl({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--fg-secondary)]">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={cn(
          'h-8 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 text-xs text-[var(--fg-primary)] transition-colors',
          'hover:border-[var(--border-strong)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-page)]',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'pointer-coarse:min-h-11',
        )}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function StringArrayControl({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string[];
  placeholder: string;
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  return (
    <Input
      size="sm"
      label={label}
      value={value.join(', ')}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(parseDelimitedList(event.currentTarget.value))}
    />
  );
}

function readBoolean(config: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = config[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readString(config: Record<string, unknown>, key: string, fallback: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : fallback;
}

function readNullableString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

function readNumber(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readStringArray(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function parseDelimitedList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateSnapshot(snapshot: SerumStatusSnapshot): {
  label: string;
  detail: string;
  status: SerumSignalStatus;
}[] {
  const blockedSignals = snapshot.signalHealth.filter((signal) =>
    signal.status === 'blocked' || signal.status === 'error'
  );
  const attentionSignals = snapshot.signalHealth.filter((signal) => signal.status === 'attention');
  return [
    {
      label: 'Deployment flag',
      detail: snapshot.enabled ? 'SERUM_ENABLED=true.' : 'SERUM_ENABLED=false.',
      status: snapshot.enabled ? 'ready' : 'disabled',
    },
    {
      label: 'Demo safety',
      detail: snapshot.demoModeEnabled ? 'Demo mode is explicit and non-production only.' : 'Demo mode is off.',
      status: snapshot.demoModeEnabled ? 'attention' : 'ready',
    },
    {
      label: 'Provider access',
      detail:
        snapshot.summary.providerConfigured || snapshot.summary.dustConfigured
          ? 'At least one provider path is configured.'
          : 'No provider path is configured.',
      status:
        snapshot.summary.providerConfigured || snapshot.summary.dustConfigured ? 'ready' : 'not_configured',
    },
    {
      label: 'Failed work',
      detail: `${snapshot.summary.failedJobs} failed queue/document/RFP job signals.`,
      status: snapshot.summary.failedJobs > 0 ? 'attention' : 'ready',
    },
    {
      label: 'Backend signal health',
      detail:
        blockedSignals.length > 0
          ? `${blockedSignals.length} backend signal source${blockedSignals.length === 1 ? '' : 's'} blocked.`
          : attentionSignals.length > 0
            ? `${attentionSignals.length} backend signal source${attentionSignals.length === 1 ? '' : 's'} need attention.`
            : 'Backend signal sources are returning deterministic status.',
      status: blockedSignals.length > 0 ? 'blocked' : attentionSignals.length > 0 ? 'attention' : 'ready',
    },
  ];
}

function findSection(id: string): SerumConfigSection {
  const fallback = SERUM_CONFIG_SECTIONS[0];
  if (!fallback) throw new Error('SERUM config sections are not configured.');
  return SERUM_CONFIG_SECTIONS.find((section) => sectionId(section) === id) ?? fallback;
}

function sectionId(section: SerumConfigSection): string {
  return `${section.configType}:${section.configKey}`;
}

function isHighRiskSection(section: SerumConfigSection): boolean {
  return HIGH_RISK_SERUM_CONFIG_TYPES.has(section.configType);
}

function statusForConfigVersion(version: SerumConfigVersion): SerumSignalStatus {
  if (version.status === 'active') return 'ready';
  if (version.status === 'draft') return 'attention';
  if (version.status === 'rolled_back') return 'disabled';
  return 'empty';
}

function statusForApprovalStatus(status: SerumConfigVersion['approvalStatus']): SerumSignalStatus {
  if (status === 'approved' || status === 'not_required') return 'ready';
  if (status === 'requested') return 'active';
  if (status === 'rejected') return 'blocked';
  return 'attention';
}

function statusForTestStatus(status: SerumConfigTestStatus): SerumSignalStatus {
  if (status === 'pass') return 'ready';
  if (status === 'warn') return 'attention';
  return 'blocked';
}

function selectRollbackTarget(snapshot: SerumConfigSnapshot | null | undefined): SerumConfigVersion | null {
  const activeId = snapshot?.active?.id;
  if (!snapshot || !activeId) return null;
  return snapshot.versions.find((version) => version.id !== activeId && version.status !== 'draft') ?? null;
}

function auditLabel(action: string): string {
  if (action === 'serum_config.draft.create') return 'Draft saved';
  if (action === 'serum_config.approval.request') return 'Approval requested';
  if (action === 'serum_config.approval.approve') return 'Approval granted';
  if (action === 'serum_config.publish') return 'Published';
  if (action === 'serum_config.rollback') return 'Rollback';
  return action;
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseConfigJson(text: string):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string } {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, message: 'Config must be a JSON object.' };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Invalid JSON.' };
  }
}

function hasChangeReason(value: string): boolean {
  return value.trim().length >= 3;
}

function formatNullableDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'with timestamp pending';
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{label}</p>
      <p className="mt-2 truncate text-sm font-medium text-[var(--fg-primary)]">{value}</p>
    </div>
  );
}

function InlineLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex h-8 items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-medium text-[var(--fg-primary)] transition-colors',
        'hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]',
      )}
    >
      {children}
    </Link>
  );
}
