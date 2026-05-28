import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { AgentOutputCard } from '@/components/agents/AgentOutputCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import {
  useAgents,
  useRfpAgentAssignments,
  useAssignAgentToRfp,
  useUnassignAgentFromRfp,
  useRfpAgentOutputs,
  useApproveOutput,
  useRejectOutput,
  useRunAgent,
} from '@/hooks/useAgents';

const STATUS_TONE: Record<string, 'jade' | 'amber' | 'tomato' | 'gray'> = {
  idle: 'jade',
  running: 'amber',
  error: 'tomato',
  disabled: 'gray',
};

export function RfpAgentsPage() {
  const { id: rfpRequestId } = useParams<{ id: string }>();
  const agents = useAgents();
  const assignments = useRfpAgentAssignments(rfpRequestId);
  const outputs = useRfpAgentOutputs(rfpRequestId);
  const assignAgent = useAssignAgentToRfp();
  const unassignAgent = useUnassignAgentFromRfp();
  const runAgent = useRunAgent();
  const approveOutput = useApproveOutput();
  const rejectOutput = useRejectOutput();

  const [assignOpen, setAssignOpen] = useState(false);
  const [runInput, setRunInput] = useState<Record<string, string>>({});
  const [runningId, setRunningId] = useState<string | null>(null);

  const allAgents = useMemo(() => agents.data?.items ?? [], [agents.data]);
  const assignedAgents = useMemo(() => assignments.data?.items ?? [], [assignments.data]);
  const allOutputs = useMemo(() => outputs.data?.items ?? [], [outputs.data]);

  // Agents not yet assigned to this RFP
  const unassignedAgents = useMemo(() => {
    const assignedIds = new Set(assignedAgents.map((a) => a.agentId));
    return allAgents.filter((a) => !assignedIds.has(a.id));
  }, [allAgents, assignedAgents]);

  const pendingOutputs = useMemo(
    () => allOutputs.filter((o) => o.status === 'pending'),
    [allOutputs],
  );

  const handleRun = async (agent: { id: string; name: string; status: string }) => {
    if (!rfpRequestId) return;
    setRunningId(agent.id);
    try {
      await runAgent.mutateAsync({
        id: agent.id,
        input: {
          message: runInput[agent.id] ?? `Run ${agent.name} on RFP`,
          rfpRequestId,
        },
      });
    } finally {
      setRunningId(null);
    }
  };

  const handleAssign = async (agentId: string) => {
    if (!rfpRequestId) return;
    await assignAgent.mutateAsync({ agentId, rfpRequestId });
    setAssignOpen(false);
  };

  if (!rfpRequestId) {
    return <EmptyState title="No RFP selected" message="Select an RFP to manage its agents." />;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="blue">RFP</Badge>
            <Badge tone="purple">Agent Squad</Badge>
          </div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)]">RFP Agents</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fg-secondary)]">
            Assign phase agents, run them with full RFP context, and review outputs before approval.
          </p>
        </div>
        <Button onClick={() => setAssignOpen(true)}>
          <Icon name="plus" size={14} className="mr-1.5" />
          Assign agent
        </Button>
      </header>

      {/* Metrics */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-tertiary)]">
            Assigned Agents
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--fg-primary)]">
            {assignedAgents.length}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-tertiary)]">
            Pending Approvals
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--fg-primary)]">
            {pendingOutputs.length}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-tertiary)]">
            Total Outputs
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--fg-primary)]">
            {allOutputs.length}
          </div>
        </div>
      </div>

      {/* Assigned Agents */}
      <section className="mb-8 space-y-4">
        <h2 className="text-lg font-semibold text-[var(--fg-primary)]">Assigned Squad</h2>

        {assignments.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : assignments.isError ? (
          <EmptyState title="Failed to load assignments" message="Try again." />
        ) : assignedAgents.length === 0 ? (
          <EmptyState
            title="No agents assigned"
            message="Assign phase agents to this RFP so they can run with full document context."
          />
        ) : (
          <div className="space-y-3">
            {assignedAgents.map((assignment) => {
              const agent = assignment.agent;
              const isRunning = runningId === agent.id || agent.status === 'running';

              return (
                <div
                  key={assignment.id}
                  className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]">
                        <Icon name="sparkle" size={17} />
                      </span>
                      <div>
                        <div className="font-medium text-[var(--fg-primary)]">{agent.name}</div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-tertiary)]">
                          <Badge tone={STATUS_TONE[agent.status] ?? 'gray'} className="text-[10px]">
                            {agent.status}
                          </Badge>
                          {agent.config.phase ? (
                            <Badge tone="blue" className="text-[10px]">
                              {agent.config.phase}
                            </Badge>
                          ) : null}
                          {agent.config.provider === 'claude' ? (
                            <Badge tone="purple" className="text-[10px]">
                              Claude
                            </Badge>
                          ) : (
                            <Badge tone="teal" className="text-[10px]">
                              Dust
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        value={runInput[agent.id] ?? ''}
                        onChange={(e) =>
                          setRunInput((prev) => ({ ...prev, [agent.id]: e.target.value }))
                        }
                        placeholder="Optional instruction..."
                        className="h-9 flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] sm:min-w-[240px]"
                      />
                      <Button size="sm" disabled={isRunning} onClick={() => void handleRun(agent)}>
                        {isRunning ? 'Running...' : 'Run'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          unassignAgent.mutate({ assignmentId: assignment.id, rfpRequestId })
                        }
                        aria-label={`Unassign ${agent.name}`}
                      >
                        <Icon name="trash" size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Outputs */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--fg-primary)]">Agent Outputs</h2>

        {outputs.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : outputs.isError ? (
          <EmptyState title="Failed to load outputs" message="Try again." />
        ) : allOutputs.length === 0 ? (
          <EmptyState
            title="No outputs yet"
            message="Run an assigned agent to generate outputs for this RFP."
          />
        ) : (
          <div className="space-y-3">
            {allOutputs.map((output) => (
              <AgentOutputCard
                key={output.id}
                output={output}
                onApprove={(id) => approveOutput.mutate({ rfpRequestId, outputId: id })}
                onReject={(id, reason) =>
                  rejectOutput.mutate({ rfpRequestId, outputId: id, reason })
                }
                isApproving={approveOutput.isPending}
                isRejecting={rejectOutput.isPending}
              />
            ))}
          </div>
        )}
      </section>

      {/* Custom assignment picker */}
      {assignOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAssignOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rfp-assign-title"
            className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-lg)]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 id="rfp-assign-title" className="text-lg font-semibold text-[var(--fg-primary)]">
                Assign agent to RFP
              </h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setAssignOpen(false)}
                className="rounded-lg p-1 text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)]"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {unassignedAgents.length === 0 ? (
              <EmptyState
                title="All agents assigned"
                message="Every available agent is already on this RFP. Create a new agent from the Agents page to add more."
              />
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {unassignedAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => handleAssign(agent.id)}
                    disabled={assignAgent.isPending}
                    className="flex w-full items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-page)] p-3 text-left transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]"
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]">
                      <Icon name="sparkle" size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[var(--fg-primary)]">
                        {agent.name}
                      </div>
                      <div className="text-xs text-[var(--fg-tertiary)]">
                        {agent.config.phase ?? 'General'} · {agent.config.provider}
                      </div>
                    </div>
                    <Icon name="plus" size={16} className="text-[var(--fg-tertiary)]" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
