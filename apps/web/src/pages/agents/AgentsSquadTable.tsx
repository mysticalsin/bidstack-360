/**
 * AgentsSquadTable — "Active squad" section.
 * Renders the filterable agent table with expandable per-agent run workspaces.
 * Owns its search query, expansion state, run-input, run-in-progress tracking,
 * and the run-history query — none of those need to surface to the parent.
 */
import { Fragment, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { SpotlightTable, SpotlightTableRow } from '@/components/ui/SpotlightTable';
import { useAgentRuns, useRunAgent, type Agent } from '@/hooks/useAgents';

import {
  ALL_PHASES,
  PHASE_TONE,
  RUN_STATUS_MAP,
  STATUS_MAP,
  formatLatency,
  formatPhase,
  lastRunLabel,
} from './agentsConfig';

interface AgentsSquadTableProps {
  isLoading: boolean;
  isError: boolean;
  allAgents: Agent[];
  selectedPhase: string;
  selectedPhaseLabel: string;
  onEdit: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
}

export function AgentsSquadTable({
  isLoading,
  isError,
  allAgents,
  selectedPhase,
  selectedPhaseLabel,
  onEdit,
  onDelete,
}: AgentsSquadTableProps) {
  const runAgent = useRunAgent();

  const [agentQuery, setAgentQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [runInput, setRunInput] = useState<Record<string, string>>({});
  const [runningId, setRunningId] = useState<string | null>(null);

  // Only fetches when a row is expanded; `undefined` disables the query.
  const agentRuns = useAgentRuns(selectedAgentId ?? undefined);

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

  if (isLoading) return <LoadingSkeleton rows={6} />;

  if (isError) return <EmptyState title="Failed to load agents" message="Please try again." />;

  if (!allAgents.length) {
    return (
      <EmptyState
        title="No agents yet"
        message="Create your first RFP phase agent or use a starter template above."
      />
    );
  }

  return (
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

      {/* sr-only live region — announces filtered agent count to screen readers */}
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
                          onClick={() => onEdit(agent)}
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
                          onClick={() => onDelete(agent)}
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
                                {formatPhase(agent.config.phase)} – {agent.name}
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
                                      <td className="px-3 py-2">{formatLatency(run.latencyMs)}</td>
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
  );
}
