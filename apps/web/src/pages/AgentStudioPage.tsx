// Agent Studio — the user-facing surface for the crew (CrewAI-style) infra.
//
// Infrastructure, not a toy: ADMINS author the agents + crews (create / delete /
// load standard); regular MEMBERS may only RUN a crew and read the result. The
// page is open to members; every authoring control is gated behind useIsAdmin().

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { confirm } from '@/components/ui/ConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsAdmin } from '@/lib/auth';
import { api } from '@/lib/api';

interface CrewAgent {
  id: string;
  agentKey: string;
  role: string;
  goal: string;
  backstory: string;
  isStandard: boolean;
}
interface CrewListItem {
  id: string;
  name: string;
  description: string | null;
  process: string;
  taskCount: number;
}
interface CrewRunStep {
  taskId: string;
  agentId: string;
  output: string;
  ok: boolean;
}
interface CrewRun {
  id: string;
  status: string;
  finalOutput: string | null;
  results: CrewRunStep[] | null;
  error: string | null;
}

const RUNNING = new Set(['queued', 'running']);

export function AgentStudioPage() {
  useDocumentTitle();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();

  const agents = useQuery<{ items: CrewAgent[] }>({
    queryKey: ['crew-agents'],
    queryFn: ({ signal }) => api('/api/v1/crew-agents', { signal }),
  });
  const crews = useQuery<{ items: CrewListItem[] }>({
    queryKey: ['crews'],
    queryFn: ({ signal }) => api('/api/v1/crews', { signal }),
  });

  const seedStandard = useMutation({
    mutationFn: () => api('/api/v1/crews/seed-standard', { method: 'POST', body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crew-agents'] });
      qc.invalidateQueries({ queryKey: ['crews'] });
      toast.success('Standard agents + RFP crew loaded');
    },
    onError: () => toast.error('Could not load the standard agents'),
  });

  const isEmpty = !agents.isLoading && (agents.data?.items.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      <header className="page-head">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-primary)]">
            Bids &amp; RFP
          </p>
          <h1 className="page-title">Agent Studio</h1>
          <p className="page-sub">
            Role-based AI agents that answer each step of an RFP.{' '}
            {isAdmin ? 'Author them here.' : 'Run a crew and review the result.'}
          </p>
        </div>
        {isAdmin && (
          <LiquidGlassButton
            size="sm"
            onClick={() => seedStandard.mutate()}
            disabled={seedStandard.isPending}
          >
            <Icon name="sparkle" size={14} />
            {seedStandard.isPending ? 'Loading…' : 'Load standard agents'}
          </LiquidGlassButton>
        )}
      </header>

      {/* ── Agents ─────────────────────────────────────────────── */}
      <AgentsSection
        agents={agents}
        isAdmin={isAdmin}
        isEmpty={isEmpty}
        onSeed={() => seedStandard.mutate()}
        seedPending={seedStandard.isPending}
      />

      {/* ── Crews ──────────────────────────────────────────────── */}
      <CrewsSection crews={crews} agents={agents.data?.items ?? []} />
    </div>
  );
}

// ─── Agents ──────────────────────────────────────────────────────────────────

function AgentsSection({
  agents,
  isAdmin,
  isEmpty,
  onSeed,
  seedPending,
}: {
  agents: ReturnType<typeof useQuery<{ items: CrewAgent[] }>>;
  isAdmin: boolean;
  isEmpty: boolean;
  onSeed: () => void;
  seedPending: boolean;
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/v1/crew-agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Agent deleted');
      return qc.invalidateQueries({ queryKey: ['crew-agents'] });
    },
    onError: () => toast.error('Could not delete the agent'),
  });

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Agents</h2>
        {isAdmin && (agents.data?.items.length ?? 0) > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New agent'}
          </Button>
        )}
      </div>

      {isAdmin && creating && <NewAgentForm onDone={() => setCreating(false)} />}

      {agents.isLoading ? (
        <div className="p-4">
          <LoadingSkeleton rows={3} />
        </div>
      ) : agents.isError ? (
        <div className="p-4">
          <ErrorState
            title="Couldn’t load agents"
            message={agents.error instanceof Error ? agents.error.message : 'Please retry.'}
            action={
              <Button variant="secondary" size="sm" onClick={() => agents.refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      ) : isEmpty ? (
        <div className="p-6">
          <EmptyState
            title="No agents yet"
            message={
              isAdmin
                ? 'Load the standard legal / finance / marketing / sales agents to get started, or create your own.'
                : 'An admin hasn’t set up any agents yet.'
            }
            action={
              isAdmin ? (
                <Button onClick={onSeed} disabled={seedPending}>
                  {seedPending ? 'Loading…' : 'Load standard agents'}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.data?.items.map((a) => (
            <div
              key={a.id}
              className="flex flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--fg-primary)]">{a.role}</span>
                <span
                  className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${
                    a.isStandard
                      ? 'bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]'
                      : 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]'
                  }`}
                >
                  {a.isStandard ? 'STANDARD' : 'CUSTOM'}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--fg-secondary)]">{a.goal}</p>
              <p className="mt-1 line-clamp-2 text-xs text-[var(--fg-tertiary)]">{a.backstory}</p>
              {isAdmin && (
                <div className="mt-auto flex justify-end pt-2">
                  <button
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${a.role}?`,
                        description:
                          'This removes the agent from every crew that uses it. This cannot be undone.',
                        confirmLabel: 'Delete',
                        destructive: true,
                      });
                      if (ok) del.mutate(a.id);
                    }}
                    disabled={del.isPending && del.variables === a.id}
                    aria-label={`Delete ${a.role}`}
                    className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-[var(--fg-tertiary)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] pointer-coarse:min-h-11"
                  >
                    <Icon name="trash" size={13} /> Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function NewAgentForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ agentKey: '', role: '', goal: '', backstory: '' });
  const create = useMutation({
    mutationFn: () => api('/api/v1/crew-agents', { method: 'POST', body: { ...form, tools: [] } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crew-agents'] });
      onDone();
    },
  });
  const valid = form.agentKey && form.role && form.goal && form.backstory;
  return (
    <div className="space-y-2 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          className="dialog-input"
          placeholder="Key (e.g. security_lead)"
          aria-label="Agent key"
          value={form.agentKey}
          onChange={(e) =>
            setForm({ ...form, agentKey: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })
          }
        />
        <input
          className="dialog-input"
          placeholder="Role (e.g. Security Lead)"
          aria-label="Role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        />
      </div>
      <input
        className="dialog-input w-full"
        placeholder="Goal — what this agent is responsible for"
        aria-label="Goal"
        value={form.goal}
        onChange={(e) => setForm({ ...form, goal: e.target.value })}
      />
      <textarea
        className="dialog-input min-h-[64px] w-full"
        placeholder="Backstory — the expertise + voice that shapes its answers"
        aria-label="Backstory"
        value={form.backstory}
        onChange={(e) => setForm({ ...form, backstory: e.target.value })}
      />
      {create.isError && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {create.error instanceof Error ? create.error.message : 'Failed to create agent.'}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => create.mutate()} disabled={!valid || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create agent'}
        </Button>
      </div>
    </div>
  );
}

// ─── Crews + run ─────────────────────────────────────────────────────────────

function CrewsSection({
  crews,
  agents,
}: {
  crews: ReturnType<typeof useQuery<{ items: CrewListItem[] }>>;
  agents: CrewAgent[];
}) {
  const [runCrewId, setRunCrewId] = useState<string | null>(null);

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Crews</h2>
        <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
          A crew runs its agents over your RFP, step by step.
        </p>
      </div>
      {crews.isLoading ? (
        <div className="p-4">
          <LoadingSkeleton rows={2} />
        </div>
      ) : crews.isError ? (
        <div className="p-4">
          <ErrorState
            title="Couldn’t load crews"
            message={crews.error instanceof Error ? crews.error.message : 'Please retry.'}
            action={
              <Button variant="secondary" size="sm" onClick={() => crews.refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      ) : (crews.data?.items.length ?? 0) === 0 ? (
        <div className="p-6">
          <EmptyState
            title="No crews yet"
            message="Once agents exist, an admin can assemble them into a crew. The standard set ships with a ready-to-run RFP Response Crew."
          />
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {crews.data?.items.map((c) => (
            <li key={c.id}>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--fg-primary)]">{c.name}</div>
                  <div className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
                    {c.process} · {c.taskCount} step{c.taskCount === 1 ? '' : 's'}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => setRunCrewId(runCrewId === c.id ? null : c.id)}
                  aria-expanded={runCrewId === c.id}
                >
                  {runCrewId === c.id ? 'Close' : 'Run'}
                </Button>
              </div>
              {runCrewId === c.id && <RunPanel crewId={c.id} agents={agents} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RunPanel({ crewId, agents }: { crewId: string; agents: CrewAgent[] }) {
  const [rfp, setRfp] = useState('');
  const [runId, setRunId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () =>
      api<{ runId: string }>(`/api/v1/crews/${crewId}/run`, {
        method: 'POST',
        body: { inputs: { rfp } },
      }),
    onSuccess: (data) => setRunId(data.runId),
    onError: () => toast.error('Could not start the run'),
  });

  const run = useQuery<CrewRun>({
    queryKey: ['crew-run', runId],
    queryFn: ({ signal }) => api(`/api/v1/crew-runs/${runId}`, { signal }),
    enabled: Boolean(runId),
    refetchInterval: (q) => (RUNNING.has(q.state.data?.status ?? '') ? 1500 : false),
  });

  const roleByKey = new Map(agents.map((a) => [a.agentKey, a.role]));

  return (
    <div className="space-y-3 bg-[var(--surface-sunken)] px-4 py-3">
      <textarea
        className="dialog-input min-h-[96px] w-full"
        placeholder="Paste the RFP text here…"
        aria-label="RFP text"
        value={rfp}
        onChange={(e) => setRfp(e.target.value)}
        disabled={start.isPending || Boolean(runId)}
      />
      {!runId && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => start.mutate()}
            disabled={!rfp.trim() || start.isPending}
          >
            {start.isPending ? 'Starting…' : 'Run crew'}
          </Button>
        </div>
      )}
      {start.isError && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {start.error instanceof Error ? start.error.message : 'Failed to start the run.'}
        </p>
      )}

      {runId && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div
              className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]"
              role="status"
              aria-live="polite"
            >
              {run.data && RUNNING.has(run.data.status) ? (
                <Icon name="loader" size={13} className="animate-spin" />
              ) : null}
              Status: <span className="font-medium">{run.data?.status ?? 'queued'}</span>
            </div>
            {(run.isError || (run.data && !RUNNING.has(run.data.status))) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRunId(null);
                  start.reset();
                }}
              >
                Run another
              </Button>
            )}
          </div>

          {run.isError && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              Couldn’t load the run status — reconnecting…
            </p>
          )}
          {run.data?.status === 'failed' && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {run.data.error ?? 'The run failed.'}
            </p>
          )}

          {run.data?.results?.map((s) => (
            <div
              key={s.taskId}
              className={`rounded-lg border bg-[var(--surface-card)] p-2 ${
                s.ok ? 'border-[var(--border-subtle)]' : 'border-[var(--tag-amber-fg)]'
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--fg-primary)]">
                {roleByKey.get(s.agentId) ?? s.agentId}
                <span className="text-[var(--fg-tertiary)]">· {s.taskId}</span>
                {!s.ok && <span className="text-[var(--tag-amber-fg)]">· fallback</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--fg-secondary)]">
                {s.output}
              </p>
            </div>
          ))}

          {run.data?.finalOutput && !RUNNING.has(run.data.status) && (
            <div
              className={`rounded-lg border bg-[var(--surface-card)] p-3 ${
                run.data.status === 'partial'
                  ? 'border-[var(--tag-amber-fg)]'
                  : 'border-[var(--brand-primary)]'
              }`}
            >
              <div
                className={`text-xs font-semibold ${
                  run.data.status === 'partial'
                    ? 'text-[var(--tag-amber-fg)]'
                    : 'text-[var(--brand-primary)]'
                }`}
              >
                {run.data.status === 'partial'
                  ? 'Final response (some steps used a fallback)'
                  : 'Final response'}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--fg-primary)]">
                {run.data.finalOutput}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
