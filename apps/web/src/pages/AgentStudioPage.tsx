// Agent Studio — the user-facing surface for the crew (CrewAI-style) infra.
//
// Infrastructure, not a toy: ADMINS author the agents + crews (create / delete /
// load standard); MEMBERS holding the `agents:write` permission may RUN a crew
// and read the result. The page is open to all members, but every authoring
// control is gated behind useIsAdmin() and the run control behind
// useHasPermission('agents:write') — the backend enforces the same permission
// on POST /crews/:id/run, so gating client-side avoids a 403 after the user
// has already filled out the RFP form.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useHasPermission } from '@/hooks/useCapabilities';
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
  const { t } = useTranslation('crm');
  const isAdmin = useIsAdmin();
  const canRunCrews = useHasPermission('agents:write');
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
      toast.success(t('agentStudio.toastStandardLoaded', 'Standard agents + RFP crew loaded'));
    },
    onError: () =>
      toast.error(t('agentStudio.toastStandardLoadError', 'Could not load the standard agents')),
  });

  const isEmpty = !agents.isLoading && (agents.data?.items.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      <header className="page-head">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-primary)]">
            {t('agentStudio.eyebrow', 'Bids & RFP')}
          </p>
          <h1 className="page-title">{t('agentStudio.title', 'Agent Studio')}</h1>
          <p className="page-sub">
            {t('agentStudio.subtitle', 'Role-based AI agents that answer each step of an RFP.')}{' '}
            {isAdmin
              ? t('agentStudio.subtitleAdmin', 'Author them here.')
              : canRunCrews
                ? t('agentStudio.subtitleMember', 'Run a crew and review the result.')
                : t('agentStudio.subtitleReadOnly', 'Browse the agents and crews an admin has set up.')}
          </p>
        </div>
        {isAdmin && (
          <LiquidGlassButton
            size="sm"
            onClick={() => seedStandard.mutate()}
            disabled={seedStandard.isPending}
          >
            <Icon name="sparkle" size={14} />
            {seedStandard.isPending
              ? t('agentStudio.loading', 'Loading…')
              : t('agentStudio.loadStandardAgents', 'Load standard agents')}
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
      <CrewsSection crews={crews} agents={agents.data?.items ?? []} canRunCrews={canRunCrews} />
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
  const { t } = useTranslation('crm');
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/v1/crew-agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('agentStudio.toastAgentDeleted', 'Agent deleted'));
      return qc.invalidateQueries({ queryKey: ['crew-agents'] });
    },
    onError: () => toast.error(t('agentStudio.toastAgentDeleteError', 'Could not delete the agent')),
  });

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('agentStudio.agentsHeading', 'Agents')}
        </h2>
        {isAdmin && (agents.data?.items.length ?? 0) > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setCreating((v) => !v)}>
            {creating ? t('agentStudio.cancel', 'Cancel') : t('agentStudio.newAgent', 'New agent')}
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
            title={t('agentStudio.agentsLoadErrorTitle', 'Couldn’t load agents')}
            message={
              agents.error instanceof Error
                ? agents.error.message
                : t('agentStudio.pleaseRetry', 'Please retry.')
            }
            action={
              <Button variant="secondary" size="sm" onClick={() => agents.refetch()}>
                {t('agentStudio.retry', 'Retry')}
              </Button>
            }
          />
        </div>
      ) : isEmpty ? (
        <div className="p-6">
          <EmptyState
            title={t('agentStudio.agentsEmptyTitle', 'No agents yet')}
            message={
              isAdmin
                ? t(
                    'agentStudio.agentsEmptyAdmin',
                    'Load the standard legal / finance / marketing / sales agents to get started, or create your own.',
                  )
                : t('agentStudio.agentsEmptyMember', 'An admin hasn’t set up any agents yet.')
            }
            action={
              isAdmin ? (
                <Button onClick={onSeed} disabled={seedPending}>
                  {seedPending
                    ? t('agentStudio.loading', 'Loading…')
                    : t('agentStudio.loadStandardAgents', 'Load standard agents')}
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
                  {a.isStandard
                    ? t('agentStudio.badgeStandard', 'STANDARD')
                    : t('agentStudio.badgeCustom', 'CUSTOM')}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--fg-secondary)]">{a.goal}</p>
              <p className="mt-1 line-clamp-2 text-xs text-[var(--fg-tertiary)]">{a.backstory}</p>
              {isAdmin && (
                <div className="mt-auto flex justify-end pt-2">
                  <button
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('agentStudio.deleteAgentConfirmTitle', 'Delete {{role}}?', {
                          role: a.role,
                        }),
                        description: t(
                          'agentStudio.deleteAgentConfirmDescription',
                          'This removes the agent from every crew that uses it. This cannot be undone.',
                        ),
                        confirmLabel: t('agentStudio.delete', 'Delete'),
                        destructive: true,
                      });
                      if (ok) del.mutate(a.id);
                    }}
                    disabled={del.isPending && del.variables === a.id}
                    aria-label={t('agentStudio.deleteAgentAriaLabel', 'Delete {{role}}', {
                      role: a.role,
                    })}
                    className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-[var(--fg-tertiary)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] pointer-coarse:min-h-11"
                  >
                    <Icon name="trash" size={13} /> {t('agentStudio.delete', 'Delete')}
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
  const { t } = useTranslation('crm');
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
          placeholder={t('agentStudio.agentKeyPlaceholder', 'Key (e.g. security_lead)')}
          aria-label={t('agentStudio.agentKeyAriaLabel', 'Agent key')}
          value={form.agentKey}
          onChange={(e) =>
            setForm({ ...form, agentKey: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })
          }
        />
        <input
          className="dialog-input"
          placeholder={t('agentStudio.rolePlaceholder', 'Role (e.g. Security Lead)')}
          aria-label={t('agentStudio.roleAriaLabel', 'Role')}
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        />
      </div>
      <input
        className="dialog-input w-full"
        placeholder={t('agentStudio.goalPlaceholder', 'Goal — what this agent is responsible for')}
        aria-label={t('agentStudio.goalAriaLabel', 'Goal')}
        value={form.goal}
        onChange={(e) => setForm({ ...form, goal: e.target.value })}
      />
      <textarea
        className="dialog-input min-h-[64px] w-full"
        placeholder={t(
          'agentStudio.backstoryPlaceholder',
          'Backstory — the expertise + voice that shapes its answers',
        )}
        aria-label={t('agentStudio.backstoryAriaLabel', 'Backstory')}
        value={form.backstory}
        onChange={(e) => setForm({ ...form, backstory: e.target.value })}
      />
      {create.isError && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {create.error instanceof Error
            ? create.error.message
            : t('agentStudio.createAgentError', 'Failed to create agent.')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone}>
          {t('agentStudio.cancel', 'Cancel')}
        </Button>
        <Button size="sm" onClick={() => create.mutate()} disabled={!valid || create.isPending}>
          {create.isPending
            ? t('agentStudio.creating', 'Creating…')
            : t('agentStudio.createAgent', 'Create agent')}
        </Button>
      </div>
    </div>
  );
}

// ─── Crews + run ─────────────────────────────────────────────────────────────

function CrewsSection({
  crews,
  agents,
  canRunCrews,
}: {
  crews: ReturnType<typeof useQuery<{ items: CrewListItem[] }>>;
  agents: CrewAgent[];
  canRunCrews: boolean;
}) {
  const { t } = useTranslation('crm');
  const [runCrewId, setRunCrewId] = useState<string | null>(null);
  const runPermissionHint = t(
    'agentStudio.runPermissionHint',
    'You need agent run access to run a crew. Ask an admin to grant it.',
  );

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('agentStudio.crewsHeading', 'Crews')}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
          {t('agentStudio.crewsSubtitle', 'A crew runs its agents over your RFP, step by step.')}
        </p>
      </div>
      {crews.isLoading ? (
        <div className="p-4">
          <LoadingSkeleton rows={2} />
        </div>
      ) : crews.isError ? (
        <div className="p-4">
          <ErrorState
            title={t('agentStudio.crewsLoadErrorTitle', 'Couldn’t load crews')}
            message={
              crews.error instanceof Error
                ? crews.error.message
                : t('agentStudio.pleaseRetry', 'Please retry.')
            }
            action={
              <Button variant="secondary" size="sm" onClick={() => crews.refetch()}>
                {t('agentStudio.retry', 'Retry')}
              </Button>
            }
          />
        </div>
      ) : (crews.data?.items.length ?? 0) === 0 ? (
        <div className="p-6">
          <EmptyState
            title={t('agentStudio.crewsEmptyTitle', 'No crews yet')}
            message={t(
              'agentStudio.crewsEmptyMessage',
              'Once agents exist, an admin can assemble them into a crew. The standard set ships with a ready-to-run RFP Response Crew.',
            )}
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
                    {c.process} ·{' '}
                    {t('agentStudio.stepCount', '{{count}} step', { count: c.taskCount })}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => setRunCrewId(runCrewId === c.id ? null : c.id)}
                  aria-expanded={runCrewId === c.id}
                  disabled={!canRunCrews}
                  title={canRunCrews ? undefined : runPermissionHint}
                  aria-label={
                    canRunCrews
                      ? undefined
                      : `${t('agentStudio.run', 'Run')} — ${runPermissionHint}`
                  }
                >
                  {runCrewId === c.id
                    ? t('agentStudio.close', 'Close')
                    : t('agentStudio.run', 'Run')}
                </Button>
              </div>
              {canRunCrews && runCrewId === c.id && <RunPanel crewId={c.id} agents={agents} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RunPanel({ crewId, agents }: { crewId: string; agents: CrewAgent[] }) {
  const { t } = useTranslation('crm');
  const [rfp, setRfp] = useState('');
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () =>
      api<{ runId: string }>(`/api/v1/crews/${crewId}/run`, {
        method: 'POST',
        body: { inputs: { rfp }, approvalConfirmed },
      }),
    onSuccess: (data) => setRunId(data.runId),
    onError: () => toast.error(t('agentStudio.toastRunStartError', 'Could not start the run')),
  });

  const run = useQuery<CrewRun>({
    queryKey: ['crew-run', runId],
    queryFn: ({ signal }) => api(`/api/v1/crew-runs/${runId}`, { signal }),
    enabled: Boolean(runId),
    refetchInterval: (q) => (RUNNING.has(q.state.data?.status ?? '') ? 1500 : false),
  });

  const cancel = useMutation({
    mutationFn: () => api(`/api/v1/crew-runs/${runId}/cancel`, { method: 'POST' }),
    onSuccess: () => void run.refetch(),
    onError: () => toast.error(t('agentStudio.toastCancelError', 'Could not cancel the run')),
  });

  const roleByKey = new Map(agents.map((a) => [a.agentKey, a.role]));

  return (
    <div className="space-y-3 bg-[var(--surface-sunken)] px-4 py-3">
      <textarea
        className="dialog-input min-h-[96px] w-full"
        placeholder={t('agentStudio.rfpPlaceholder', 'Paste the RFP text here…')}
        aria-label={t('agentStudio.rfpAriaLabel', 'RFP text')}
        value={rfp}
        onChange={(e) => setRfp(e.target.value)}
        disabled={start.isPending || Boolean(runId)}
      />
      {!runId && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-h-11 items-start gap-3 text-xs text-[var(--fg-secondary)]">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--accent)]"
              checked={approvalConfirmed}
              onChange={(e) => setApprovalConfirmed(e.target.checked)}
              disabled={start.isPending}
            />
            <span>
              {t(
                'agentStudio.approvalConfirmed',
                'I reviewed this run and approve the listed agents to process this input.',
              )}
            </span>
          </label>
          <Button
            size="sm"
            onClick={() => start.mutate()}
            disabled={!rfp.trim() || !approvalConfirmed || start.isPending}
          >
            {start.isPending
              ? t('agentStudio.starting', 'Starting…')
              : t('agentStudio.runCrew', 'Run crew')}
          </Button>
        </div>
      )}
      {start.isError && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {start.error instanceof Error
            ? start.error.message
            : t('agentStudio.runStartError', 'Failed to start the run.')}
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
              {t('agentStudio.statusLabel', 'Status:')}{' '}
              <span className="font-medium">{run.data?.status ?? 'queued'}</span>
            </div>
            {run.data && RUNNING.has(run.data.status) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
              >
                {cancel.isPending
                  ? t('agentStudio.cancelling', 'Cancelling…')
                  : t('agentStudio.cancelRun', 'Cancel run')}
              </Button>
            )}
            {(run.isError || (run.data && !RUNNING.has(run.data.status))) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRunId(null);
                  start.reset();
                }}
              >
                {t('agentStudio.runAnother', 'Run another')}
              </Button>
            )}
          </div>

          {run.isError && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {t('agentStudio.runStatusError', 'Couldn’t load the run status — reconnecting…')}
            </p>
          )}
          {run.data?.status === 'failed' && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {run.data.error ?? t('agentStudio.runFailed', 'The run failed.')}
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
                {!s.ok && (
                  <span className="text-[var(--tag-amber-fg)]">
                    · {t('agentStudio.fallback', 'fallback')}
                  </span>
                )}
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
                  ? t(
                      'agentStudio.finalResponsePartial',
                      'Final response (some steps used a fallback)',
                    )
                  : t('agentStudio.finalResponse', 'Final response')}
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
