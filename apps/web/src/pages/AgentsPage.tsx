import { Fragment, useMemo, useState } from 'react';

import { AgentDialog } from '@/components/agents/AgentDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { SpotlightTable, SpotlightTableRow } from '@/components/ui/SpotlightTable';
import {
  useAgentRuns,
  useAgents,
  useCreateAgent,
  useDeleteAgent,
  useProvisionRfpAgentTemplate,
  useRfpAgentTemplates,
  useRunAgent,
  useUpdateAgent,
  type Agent,
} from '@/hooks/useAgents';

const ALL_PHASES = 'all';

const STATUS_MAP: Record<
  Agent['status'],
  { label: string; tone: 'jade' | 'amber' | 'tomato' | 'gray' }
> = {
  idle: { label: 'Idle', tone: 'jade' },
  running: { label: 'Running', tone: 'amber' },
  error: { label: 'Error', tone: 'tomato' },
  disabled: { label: 'Disabled', tone: 'gray' },
};

const RUN_STATUS_MAP: Record<string, 'jade' | 'tomato' | 'amber' | 'gray'> = {
  completed: 'jade',
  failed: 'tomato',
  running: 'amber',
  queued: 'gray',
  cancelled: 'gray',
};

const PHASE_TONE: Record<
  string,
  'blue' | 'jade' | 'amber' | 'tomato' | 'purple' | 'teal' | 'rose' | 'gray'
> = {
  opportunity_qualification: 'gray',
  document_intake: 'blue',
  solicitation_deep_read: 'purple',
  compliance_matrix: 'teal',
  red_flags: 'tomato',
  solution_strategy: 'jade',
  pricing_commercial: 'amber',
  legal_review: 'rose',
  security_privacy: 'blue',
  draft_response: 'purple',
  color_team_review: 'teal',
  submission_readiness: 'amber',
  post_submission: 'gray',
};

function formatLatency(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatPhase(value: string | undefined): string {
  if (!value) return 'General';
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function lastRunLabel(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function countByPhase(items: Array<{ phase?: string }>): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    if (!item.phase) return acc;
    acc[item.phase] = (acc[item.phase] ?? 0) + 1;
    return acc;
  }, {});
}

export function AgentsPage() {
  const agents = useAgents();
  const templates = useRfpAgentTemplates();
  const createAgent = useCreateAgent();
  const provisionTemplate = useProvisionRfpAgentTemplate();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const runAgent = useRunAgent();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [runInput, setRunInput] = useState<Record<string, string>>({});
  const [runningId, setRunningId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [agentQuery, setAgentQuery] = useState('');
  const [templateQuery, setTemplateQuery] = useState('');
  const [selectedPhase, setSelectedPhase] = useState<string>(ALL_PHASES);

  const allAgents = useMemo(() => agents.data?.items ?? [], [agents.data?.items]);
  const phaseDefinitions = templates.data?.phases ?? [];
  const templateCatalog = useMemo(
    () => templates.data?.templates ?? [],
    [templates.data?.templates],
  );
  const agentRuns = useAgentRuns(selectedAgentId ?? undefined);

  const phaseCoverage = useMemo(() => {
    const coverage = new Set<string>();
    for (const agent of allAgents) {
      if (agent.config.phase) coverage.add(agent.config.phase);
    }
    return coverage;
  }, [allAgents]);

  const agentsByPhase = useMemo(
    () => countByPhase(allAgents.map((agent) => ({ phase: agent.config.phase }))),
    [allAgents],
  );

  const templatesByPhase = useMemo(
    () => countByPhase(templateCatalog.map((template) => ({ phase: template.phase }))),
    [templateCatalog],
  );

  const selectedPhaseDefinition = phaseDefinitions.find((phase) => phase.id === selectedPhase);
  const selectedPhaseLabel =
    selectedPhase === ALL_PHASES
      ? 'All phases'
      : (selectedPhaseDefinition?.label ?? formatPhase(selectedPhase));
  const totalPhaseCount = phaseDefinitions.length || 13;
  const claudeAgentCount = allAgents.filter((agent) => agent.config.provider === 'claude').length;
  const runningAgentCount = allAgents.filter((agent) => agent.status === 'running').length;
  const scheduledAgentCount = allAgents.filter((agent) => Boolean(agent.scheduleCron)).length;

  const filteredTemplates = useMemo(() => {
    const query = templateQuery.trim().toLowerCase();
    return templateCatalog.filter((template) => {
      const matchesPhase = selectedPhase === ALL_PHASES || template.phase === selectedPhase;
      if (!matchesPhase) return false;
      if (!query) return true;
      return [
        template.name,
        template.description,
        template.phase,
        template.defaultConfig.provider,
        template.defaultConfig.outputContract,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [selectedPhase, templateCatalog, templateQuery]);

  const visibleAgents = useMemo(() => {
    const query = agentQuery.trim().toLowerCase();
    return allAgents.filter((agent) => {
      const matchesPhase = selectedPhase === ALL_PHASES || agent.config.phase === selectedPhase;
      if (!matchesPhase) return false;
      if (!query) return true;
      return [
        agent.name,
        agent.description,
        agent.status,
        agent.scheduleCron,
        agent.config.phase,
        agent.config.provider,
        agent.config.model,
        agent.config.dustAgentId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [agentQuery, allAgents, selectedPhase]);

  const handleCreate = async (body: Parameters<typeof createAgent.mutateAsync>[0]) => {
    await createAgent.mutateAsync(body);
    setDialogOpen(false);
  };

  const handleUpdate = async (body: Parameters<typeof updateAgent.mutateAsync>[0]) => {
    await updateAgent.mutateAsync(body);
    setDialogOpen(false);
    setEditingAgent(null);
  };

  const handleRun = async (agent: Agent) => {
    setRunningId(agent.id);
    try {
      await runAgent.mutateAsync({
        id: agent.id,
        input: { message: runInput[agent.id] ?? '' },
      });
    } finally {
      setRunningId(null);
    }
  };

  const commandMetrics = [
    {
      label: 'Phase coverage',
      value: `${phaseCoverage.size}/${totalPhaseCount}`,
      detail: 'covered gates',
      icon: 'git-branch' as const,
      tone: 'blue' as const,
    },
    {
      label: 'Claude squad',
      value: String(claudeAgentCount),
      detail: `${scheduledAgentCount} scheduled`,
      icon: 'sparkle' as const,
      tone: 'purple' as const,
    },
    {
      label: 'Live work',
      value: String(runningAgentCount),
      detail: 'active runs',
      icon: 'clock' as const,
      tone: runningAgentCount > 0 ? ('amber' as const) : ('jade' as const),
    },
    {
      label: 'Templates',
      value: String(templateCatalog.length),
      detail: `${filteredTemplates.length} visible`,
      icon: 'book' as const,
      tone: 'teal' as const,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="blue">BidStack 360</Badge>
            <Badge tone="purple">RFP agent squad</Badge>
          </div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)]">Agents</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fg-secondary)]">
            Phase agents for intake, red flags, compliance, legal, security, drafting, and
            submission.
          </p>
        </div>
        <LiquidGlassButton
          onClick={() => {
            setEditingAgent(null);
            setDialogOpen(true);
          }}
        >
          <Icon name="plus" size={14} className="mr-1.5" />
          New agent
        </LiquidGlassButton>
      </header>

      <section
        className="mb-8 overflow-hidden rounded-[24px] border border-[var(--border-subtle)] p-4 shadow-[var(--shadow-md)] sm:p-5"
        style={{
          background:
            'radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--brand-primary) 13%, transparent), transparent 32%), linear-gradient(135deg, var(--surface-card), var(--surface-page))',
        }}
      >
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-card)_84%,transparent)] p-4 shadow-[var(--shadow-xs)] sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
                  RFP command center
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-[var(--fg-secondary)]">
                  {selectedPhaseDefinition?.purpose ??
                    'Coverage, readiness, risk ownership, and agent run control in one workspace.'}
                </p>
              </div>
              <Badge
                tone={selectedPhase === ALL_PHASES ? 'gray' : (PHASE_TONE[selectedPhase] ?? 'gray')}
              >
                {selectedPhaseLabel}
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {commandMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 shadow-[var(--shadow-xs)]"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-tertiary)]">
                      {metric.label}
                    </span>
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--brand-primary)]">
                      <Icon name={metric.icon} size={15} />
                    </span>
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-[var(--fg-primary)]">
                    {metric.value}
                  </div>
                  <div className="mt-1 text-xs text-[var(--fg-secondary)]">{metric.detail}</div>
                </div>
              ))}
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--fg-tertiary)]">
                  Response phases
                </div>
                <div className="text-xs text-[var(--fg-tertiary)]">
                  {phaseCoverage.size} covered
                </div>
              </div>
              <div
                role="group"
                aria-label="Filter agents and templates by RFP phase"
                className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
              >
                <button
                  type="button"
                  aria-pressed={selectedPhase === ALL_PHASES}
                  onClick={() => setSelectedPhase(ALL_PHASES)}
                  className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-medium text-[var(--fg-secondary)] shadow-[var(--shadow-xs)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] aria-pressed:border-[var(--brand-primary)] aria-pressed:bg-[var(--brand-primary-tint)] aria-pressed:text-[var(--brand-primary)]"
                >
                  All
                  <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] text-[var(--fg-tertiary)]">
                    {allAgents.length}
                  </span>
                </button>
                {phaseDefinitions.map((phase) => {
                  const agentCount = agentsByPhase[phase.id] ?? 0;
                  const templateCount = templatesByPhase[phase.id] ?? 0;
                  const isActive = selectedPhase === phase.id;
                  const hasCoverage = phaseCoverage.has(phase.id);

                  return (
                    <button
                      key={phase.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setSelectedPhase(phase.id)}
                      className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-medium text-[var(--fg-secondary)] shadow-[var(--shadow-xs)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] aria-pressed:border-[var(--brand-primary)] aria-pressed:bg-[var(--brand-primary-tint)] aria-pressed:text-[var(--brand-primary)]"
                    >
                      <span
                        className={
                          hasCoverage
                            ? 'h-2 w-2 rounded-full bg-[var(--success)]'
                            : 'h-2 w-2 rounded-full bg-[var(--fg-muted)]'
                        }
                        aria-hidden
                      />
                      {phase.label}
                      <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] text-[var(--fg-tertiary)]">
                        {agentCount}/{templateCount}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)] sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Phase gate</h2>
                <p className="mt-1 text-xs text-[var(--fg-secondary)]">
                  {selectedPhaseDefinition?.gate ?? 'Select a phase to inspect its approval gate.'}
                </p>
              </div>
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]">
                <Icon name="shield" size={18} />
              </span>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl bg-[var(--surface-sunken)] p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-secondary)]">
                  Decision
                </div>
                <p className="mt-1 text-sm text-[var(--fg-primary)]">
                  {selectedPhaseDefinition?.userDecision ??
                    'Coordinate bid/no-bid, risk, strategy, evidence, and submission decisions.'}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--surface-sunken)] p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-secondary)]">
                  Red-flag checks
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(
                    selectedPhaseDefinition?.redFlagChecks ?? [
                      'Missing owner',
                      'No source citation',
                      'Approval gap',
                    ]
                  ).map((check) => (
                    <Badge key={check} tone="tomato">
                      {check}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--fg-primary)]">Starter agents</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--fg-secondary)]">
              {selectedPhase === ALL_PHASES
                ? 'Provision the core RFP response squad, then tune each prompt and provider.'
                : `${selectedPhaseLabel} agents ready to provision and tune.`}
            </p>
          </div>
          <div className="relative w-full lg:max-w-sm">
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
            />
            <label className="sr-only" htmlFor="template-search">
              Search starter agents
            </label>
            <input
              id="template-search"
              value={templateQuery}
              onChange={(event) => setTemplateQuery(event.currentTarget.value)}
              placeholder="Search templates..."
              className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] pl-9 pr-3 text-sm text-[var(--fg-primary)] shadow-[var(--shadow-xs)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            />
          </div>
        </div>

        {/* sr-only live region — announces filtered template count to AT */}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {!templates.isLoading && !templates.isError
            ? `${filteredTemplates.length} template${filteredTemplates.length === 1 ? '' : 's'}${templateQuery ? ` matching "${templateQuery}"` : ''}${selectedPhase !== ALL_PHASES ? ` in ${selectedPhaseLabel}` : ''}`
            : ''}
        </p>

        {templates.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : templates.isError ? (
          <EmptyState
            title="Template catalog is unavailable"
            message="Try again after the API recovers."
          />
        ) : filteredTemplates.length === 0 ? (
          <EmptyState title="No starter agents match" message="Adjust the phase or search query." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredTemplates.map((template) => {
              const phase = phaseDefinitions.find((item) => item.id === template.phase);
              const coveredCount = agentsByPhase[template.phase] ?? 0;
              const toolsCount = template.tools.length;

              return (
                <article
                  key={template.id}
                  className="group flex min-h-[220px] flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-[var(--fg-primary)]">{template.name}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone={PHASE_TONE[template.phase] ?? 'gray'}>
                          {phase?.label ?? formatPhase(template.phase)}
                        </Badge>
                        <Badge
                          tone={template.defaultConfig.provider === 'claude' ? 'purple' : 'blue'}
                        >
                          {template.defaultConfig.provider === 'claude' ? 'Claude' : 'Dust'}
                        </Badge>
                      </div>
                    </div>
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--brand-primary)]">
                      <Icon name="sparkle" size={16} />
                    </span>
                  </div>
                  <p className="line-clamp-3 text-sm text-[var(--fg-secondary)]">
                    {template.description}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-[var(--surface-sunken)] p-2">
                      <div className="font-semibold text-[var(--fg-primary)]">{toolsCount}</div>
                      <div className="text-[var(--fg-tertiary)]">tools</div>
                    </div>
                    <div className="rounded-xl bg-[var(--surface-sunken)] p-2">
                      <div className="font-semibold text-[var(--fg-primary)]">{coveredCount}</div>
                      <div className="text-[var(--fg-tertiary)]">active</div>
                    </div>
                  </div>
                  <div className="mt-auto pt-4">
                    <Button
                      className="w-full"
                      size="sm"
                      disabled={provisionTemplate.isPending}
                      onClick={() =>
                        provisionTemplate.mutate({
                          templateId: template.id,
                          provider: 'claude',
                        })
                      }
                    >
                      {coveredCount > 0 ? 'Add another' : 'Add phase agent'}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {agents.isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : agents.isError ? (
        <EmptyState title="Failed to load agents" message="Please try again." />
      ) : !allAgents.length ? (
        <EmptyState
          title="No agents yet"
          message="Create your first RFP phase agent or use a starter template above."
        />
      ) : (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--fg-primary)]">Active squad</h2>
              <p className="mt-1 text-sm text-[var(--fg-secondary)]">
                {visibleAgents.length} of {allAgents.length} agents
                {selectedPhase !== ALL_PHASES ? ` in ${selectedPhaseLabel}` : ''}
              </p>
            </div>
            <div className="relative w-full lg:max-w-sm">
              <Icon
                name="search"
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
              />
              <label className="sr-only" htmlFor="agent-search">
                Search agents
              </label>
              <input
                id="agent-search"
                value={agentQuery}
                onChange={(event) => setAgentQuery(event.currentTarget.value)}
                placeholder="Search agents, provider, status..."
                className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] pl-9 pr-3 text-sm text-[var(--fg-primary)] shadow-[var(--shadow-xs)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              />
            </div>
          </div>

          {/* sr-only live region — announces filtered agent count to AT */}
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {`${visibleAgents.length} of ${allAgents.length} agent${allAgents.length === 1 ? '' : 's'}${selectedPhase !== ALL_PHASES ? ` in ${selectedPhaseLabel}` : ''}${agentQuery ? ` matching "${agentQuery}"` : ''}`}
          </p>

          {visibleAgents.length === 0 ? (
            <EmptyState title="No matching agents" message="Adjust the search or phase filter." />
          ) : (
            <SpotlightTable query={agentQuery} minWidth={1120} className="text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-left text-xs font-medium text-[var(--fg-tertiary)]">
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Phase</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last run</th>
                  <th className="px-4 py-3">Schedule</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleAgents.map((agent) => {
                  const isExpanded = selectedAgentId === agent.id;

                  return (
                    <Fragment key={agent.id}>
                      <SpotlightTableRow
                        query={agentQuery}
                        searchableText={[
                          agent.name,
                          agent.description,
                          agent.status,
                          agent.config.phase,
                          agent.config.provider,
                          agent.scheduleCron,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        className="border-b border-[var(--border-default)] last:border-b-0 hover:bg-[var(--surface-sunken)]"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]">
                              <Icon name="sparkle" size={17} />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-[var(--fg-primary)]">
                                {agent.name}
                              </div>
                              {agent.description ? (
                                <div className="max-w-[360px] truncate text-xs text-[var(--fg-tertiary)]">
                                  {agent.description}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={PHASE_TONE[agent.config.phase ?? ''] ?? 'gray'}>
                            {formatPhase(agent.config.phase)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={agent.config.provider === 'claude' ? 'purple' : 'blue'}>
                            {agent.config.provider === 'claude' ? 'Claude' : 'Dust'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={STATUS_MAP[agent.status].tone}>
                            {STATUS_MAP[agent.status].label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-[var(--fg-secondary)]">
                          {lastRunLabel(agent.lastRunAt)}
                        </td>
                        <td className="px-4 py-3 text-[var(--fg-secondary)]">
                          {agent.scheduleCron || '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingAgent(agent);
                                setDialogOpen(true);
                              }}
                              aria-label={`Edit ${agent.name}`}
                            >
                              <Icon name="settings" size={14} />
                            </Button>
                            <Button
                              variant={isExpanded ? 'secondary' : 'ghost'}
                              size="sm"
                              onClick={() => setSelectedAgentId(isExpanded ? null : agent.id)}
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? 'Hide' : 'View'} runs for ${agent.name}`}
                            >
                              <Icon name="eye" size={14} />
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={runningId === agent.id}
                              onClick={() => void handleRun(agent)}
                            >
                              {runningId === agent.id ? 'Running' : 'Run'}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setDeletingAgent(agent)}
                              aria-label={`Delete ${agent.name}`}
                            >
                              <Icon name="trash" size={14} />
                            </Button>
                          </div>
                        </td>
                      </SpotlightTableRow>
                      {isExpanded ? (
                        <tr className="border-b border-[var(--border-default)] bg-[var(--surface-sunken)]">
                          <td colSpan={7} className="px-4 py-4">
                            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]">
                              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <div className="text-sm font-semibold text-[var(--fg-primary)]">
                                    Run workspace
                                  </div>
                                  <div className="text-xs text-[var(--fg-secondary)]">
                                    {formatPhase(agent.config.phase)} - {agent.name}
                                  </div>
                                </div>
                                <Badge tone={agent.config.approvalRequired ? 'amber' : 'jade'}>
                                  {agent.config.approvalRequired ? 'Approval required' : 'Auto-run'}
                                </Badge>
                              </div>
                              <div className="mb-3 flex flex-col gap-2 sm:flex-row">
                                <input
                                  value={runInput[agent.id] ?? ''}
                                  onChange={(event) =>
                                    setRunInput((prev) => ({
                                      ...prev,
                                      [agent.id]: event.currentTarget.value,
                                    }))
                                  }
                                  aria-label={`Message for ${agent.name}`}
                                  placeholder="Ask for cited risks, blockers, requirements, or next actions..."
                                  className="min-h-11 flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                                />
                                <Button
                                  size="md"
                                  disabled={runningId === agent.id}
                                  onClick={() => void handleRun(agent)}
                                >
                                  Send
                                </Button>
                              </div>
                              {agentRuns.isLoading ? (
                                <LoadingSkeleton rows={3} />
                              ) : agentRuns.data?.items.length ? (
                                <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--border-default)]">
                                  <table className="w-full min-w-[760px] text-xs">
                                    <thead>
                                      <tr className="border-b border-[var(--border-default)] bg-[var(--surface-sunken)] text-left text-[var(--fg-tertiary)]">
                                        <th className="px-3 py-2">Status</th>
                                        <th className="px-3 py-2">Latency</th>
                                        <th className="px-3 py-2">Error</th>
                                        <th className="px-3 py-2">Output</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {agentRuns.data.items.map((run) => (
                                        <tr
                                          key={run.id}
                                          className="border-b border-[var(--border-default)] last:border-b-0"
                                        >
                                          <td className="px-3 py-2">
                                            <Badge
                                              tone={RUN_STATUS_MAP[run.status] ?? 'gray'}
                                              className="text-[10px]"
                                            >
                                              {run.status}
                                            </Badge>
                                          </td>
                                          <td className="px-3 py-2">
                                            {formatLatency(run.latencyMs)}
                                          </td>
                                          <td className="max-w-[220px] truncate px-3 py-2 text-[var(--danger)]">
                                            {run.error || '-'}
                                          </td>
                                          <td className="max-w-[360px] truncate px-3 py-2 text-[var(--fg-secondary)]">
                                            {run.output?.text ? String(run.output.text) : '-'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-xs text-[var(--fg-tertiary)]">No runs yet.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </SpotlightTable>
          )}
        </section>
      )}

      <AgentDialog
        key={dialogOpen ? (editingAgent?.id ?? 'new-agent') : 'closed-agent'}
        agent={editingAgent}
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingAgent(null);
        }}
        onSubmit={(body) => {
          if (editingAgent) {
            void handleUpdate({ id: editingAgent.id, ...body });
          } else {
            void handleCreate(body);
          }
        }}
        isPending={createAgent.isPending || updateAgent.isPending}
      />

      <Dialog
        open={Boolean(deletingAgent)}
        onOpenChange={(open) => !open && setDeletingAgent(null)}
      >
        <DialogContent
          title="Delete agent"
          description={
            deletingAgent
              ? `This removes ${deletingAgent.name} from the RFP agent squad.`
              : undefined
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--fg-secondary)]">
              Historical runs stay in the audit trail, but this agent will no longer be available
              for future RFP work.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeletingAgent(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteAgent.isPending || !deletingAgent}
                onClick={() => {
                  if (!deletingAgent) return;
                  deleteAgent.mutate(deletingAgent.id, {
                    onSuccess: () => setDeletingAgent(null),
                  });
                }}
              >
                Delete agent
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
