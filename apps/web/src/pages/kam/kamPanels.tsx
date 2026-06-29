/**
 * kamPanels.tsx — the KAM account cockpit panels: KPI strip, Initiative board
 * (locked state machine), per-account to-do, and the human-gate draft review.
 * All panels handle loading / error / empty. Stage transitions go through the
 * guarded API (illegal/terminal moves are rejected server-side).
 */
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import {
  ALLOWED_INITIATIVE_TRANSITIONS,
  INITIATIVE_STAGES,
  type InitiativeStageValue,
  type KamInitiativeDetail,
} from '@bidstack/shared';

import {
  type KamHandoffDetailDto,
  type KamHandoffPayloadDto,
  useApproveDraft,
  useConfirmKamHandoff,
  useExportKamHandoff,
  useKamAccountKpi,
  useKamAccountTodos,
  useKamDrafts,
  useKamHandoffs,
  useKamInitiatives,
  useRejectDraft,
  useTransitionInitiative,
} from '@/hooks/useKam';

const STAGE_LABEL: Record<InitiativeStageValue, string> = {
  initiative: 'Initiatives',
  lead: 'Leads',
  opportunity: 'Opportunities',
  dropped: 'Dropped',
};

// ─── KPI strip ───────────────────────────────────────────────────────────────
function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' }) {
  return (
    <div className="px-4 py-3">
      <div
        className={`text-xl font-semibold ${tone === 'warn' ? 'text-[var(--warning)]' : 'text-[var(--fg-primary)]'}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-[var(--fg-tertiary)]">{label}</div>
    </div>
  );
}

export function KamKpiStrip({ companyId }: { companyId: string }) {
  const { data, isLoading, isError } = useKamAccountKpi(companyId);
  if (isLoading)
    return (
      <Card>
        <LoadingSkeleton rows={1} />
      </Card>
    );
  if (isError || !data)
    return (
      <Card>
        <ErrorState title="Couldn't load KPIs" />
      </Card>
    );
  const s = data.initiativesByStage;
  return (
    <Card className="flex flex-wrap divide-x divide-[var(--border-subtle)]">
      <Stat label="Initiatives" value={s.initiative} />
      <Stat label="Leads" value={s.lead} />
      <Stat label="Opportunities" value={s.opportunity} />
      <Stat label="Open to-dos" value={data.openTasks} />
      <Stat label="Prospections" value={data.prospectionCount} />
      <Stat
        label="Stale"
        value={data.staleInitiativeCount}
        tone={data.staleInitiativeCount > 0 ? 'warn' : undefined}
      />
    </Card>
  );
}

// ─── Initiative board ────────────────────────────────────────────────────────
function InitiativeCard({ init, companyId }: { init: KamInitiativeDetail; companyId: string }) {
  const transition = useTransitionInitiative(companyId);
  const [dropping, setDropping] = useState(false);
  const [reason, setReason] = useState('');
  const targets = ALLOWED_INITIATIVE_TRANSITIONS[init.stage as InitiativeStageValue];

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-page)] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-[var(--fg-primary)]">{init.title}</p>
        <Badge tone="gray">{init.priority}</Badge>
      </div>
      {targets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {targets
            .filter((to) => to !== 'dropped')
            .map((to) => (
              <Button
                key={to}
                size="sm"
                variant="secondary"
                disabled={transition.isPending}
                onClick={() => transition.mutate({ id: init.id, body: { toStage: to } })}
              >
                → {to === 'lead' ? 'Lead' : 'Opportunity'}
              </Button>
            ))}
          {targets.includes('dropped') && !dropping && (
            <Button size="sm" variant="ghost" onClick={() => setDropping(true)}>
              Drop
            </Button>
          )}
        </div>
      )}
      {dropping && (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being dropped?"
            aria-label="Drop reason"
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-2 text-xs text-[var(--fg-primary)]"
            rows={2}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim() || transition.isPending}
              onClick={() =>
                transition.mutate(
                  { id: init.id, body: { toStage: 'dropped', droppedReason: reason.trim() } },
                  { onSuccess: () => setDropping(false) },
                )
              }
            >
              Confirm drop
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDropping(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function KamInitiativeBoard({ companyId }: { companyId: string }) {
  const { data, isLoading, isError } = useKamInitiatives(companyId);
  if (isLoading)
    return (
      <Card>
        <LoadingSkeleton rows={3} />
      </Card>
    );
  if (isError)
    return (
      <Card>
        <ErrorState title="Couldn't load initiatives" />
      </Card>
    );
  const items = data?.items ?? [];
  return (
    <Card>
      <SectionHeader title="Initiatives" caption="Initiative → Lead → Opportunity → Dropped" />
      {items.length === 0 ? (
        <EmptyState
          title="No initiatives yet"
          message="Run a workshop and approve a draft, or add one manually."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {INITIATIVE_STAGES.map((stage) => {
            const col = items.filter((i) => i.stage === stage);
            return (
              <section key={stage} aria-label={STAGE_LABEL[stage]} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                  {STAGE_LABEL[stage]} · {col.length}
                </h3>
                {col.map((init) => (
                  <InitiativeCard key={init.id} init={init} companyId={companyId} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ─── Per-account to-do ───────────────────────────────────────────────────────
export function KamTodoCard({ companyId }: { companyId: string }) {
  const { data, isLoading, isError } = useKamAccountTodos(companyId);
  if (isLoading)
    return (
      <Card>
        <LoadingSkeleton rows={3} />
      </Card>
    );
  if (isError)
    return (
      <Card>
        <ErrorState title="Couldn't load to-dos" />
      </Card>
    );
  const items = data?.items ?? [];
  return (
    <Card>
      <SectionHeader
        title="To-do"
        caption={`${data?.openCount ?? 0} open · ${data?.doneCount ?? 0} done`}
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing outstanding"
          message="No open tasks across this account's initiatives."
        />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {items.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <div>
                <p className="text-sm text-[var(--fg-primary)]">{task.title}</p>
                <p className="text-xs text-[var(--fg-tertiary)]">{task.initiativeTitle}</p>
              </div>
              <Badge tone="gray">{task.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ABC OM handoffs
const HANDOFF_TONE: Record<KamHandoffDetailDto['status'], 'gray' | 'blue' | 'jade'> = {
  draft: 'gray',
  exported: 'blue',
  confirmed: 'jade',
};

export function downloadKamHandoffPayload(payload: KamHandoffPayloadDto) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return;
  }
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `abc-om-handoff-${payload.handoffId}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function shortId(id: string) {
  return id.slice(0, 8);
}

export function KamHandoffCard({ companyId }: { companyId: string }) {
  const { data, isLoading, isError } = useKamHandoffs(companyId);
  const exportHandoff = useExportKamHandoff(companyId);
  const confirmHandoff = useConfirmKamHandoff(companyId);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [payloads, setPayloads] = useState<Record<string, KamHandoffPayloadDto>>({});

  if (isLoading)
    return (
      <Card>
        <LoadingSkeleton rows={3} />
      </Card>
    );
  if (isError)
    return (
      <Card>
        <ErrorState title="Couldn't load OM handoffs" />
      </Card>
    );

  const items = data?.items ?? [];
  return (
    <Card>
      <SectionHeader title="OM handoffs" caption="ABC opportunity-management export queue" />
      {items.length === 0 ? (
        <EmptyState
          title="No handoffs ready"
          message="Move a qualified initiative to Opportunity to create one."
        />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {items.map((handoff) => {
            const payload = payloads[handoff.id];
            const ref = refs[handoff.id] ?? handoff.externalRef ?? '';
            const canConfirm = handoff.status === 'exported' && ref.trim().length > 0;
            return (
              <li key={handoff.id} className="space-y-3 px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--fg-primary)]">
                      Handoff {shortId(handoff.id)}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
                      Target {handoff.targetSystem} · Opportunity{' '}
                      {handoff.opportunityId ? shortId(handoff.opportunityId) : 'pending'}
                    </p>
                  </div>
                  <Badge tone={HANDOFF_TONE[handoff.status]}>{handoff.status}</Badge>
                </div>

                {handoff.status === 'confirmed' ? (
                  <p className="rounded-md bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--fg-secondary)]">
                    Confirmed in ABC OM as {handoff.externalRef}
                  </p>
                ) : (
                  <div className="space-y-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={exportHandoff.isPending}
                      onClick={() =>
                        exportHandoff.mutate(handoff.id, {
                          onSuccess: ({ handoff: updated, payload: exportedPayload }) => {
                            setPayloads((current) => ({
                              ...current,
                              [updated.id]: exportedPayload,
                            }));
                            downloadKamHandoffPayload(exportedPayload);
                          },
                        })
                      }
                    >
                      <Icon name="download" size={14} ariaHidden /> Export JSON
                    </Button>

                    {handoff.status === 'exported' && (
                      <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-page)] p-3">
                        <Input
                          label="ABC OM reference"
                          value={ref}
                          onChange={(event) =>
                            setRefs((current) => ({ ...current, [handoff.id]: event.target.value }))
                          }
                          placeholder="ABC-OM-12345"
                          size="sm"
                        />
                        <Button
                          size="sm"
                          variant="success"
                          disabled={!canConfirm || confirmHandoff.isPending}
                          onClick={() =>
                            confirmHandoff.mutate({
                              id: handoff.id,
                              body: { externalRef: ref.trim() },
                            })
                          }
                        >
                          <Icon name="shield" size={14} ariaHidden /> Confirm
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {payload && (
                  <pre className="max-h-48 overflow-auto rounded-lg bg-[var(--surface-sunken)] p-3 text-xs text-[var(--fg-secondary)]">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// Human-gate draft review
export function KamDraftReview({ companyId }: { companyId: string }) {
  const { data, isLoading, isError } = useKamDrafts(companyId, 'pending');
  const approve = useApproveDraft(companyId);
  const reject = useRejectDraft(companyId);
  if (isLoading)
    return (
      <Card>
        <LoadingSkeleton rows={2} />
      </Card>
    );
  if (isError)
    return (
      <Card>
        <ErrorState title="Couldn't load drafts" />
      </Card>
    );
  const items = data?.items ?? [];
  return (
    <Card>
      <SectionHeader
        title="Workshop drafts"
        caption="AI-organized notes + to-dos awaiting your review"
      />
      {items.length === 0 ? (
        <EmptyState
          title="No drafts to review"
          message="Ingest a transcript to generate a draft for review."
        />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {items.map((draft) => {
            const note = (draft.noteDraft ?? {}) as { summary?: string };
            const inits = (draft.initiativeDrafts ?? []) as unknown[];
            const tasks = (draft.taskDrafts ?? []) as unknown[];
            return (
              <li key={draft.id} className="space-y-2 px-5 py-3">
                <p className="text-sm text-[var(--fg-primary)]">
                  {note.summary || 'Untitled draft'}
                </p>
                <p className="text-xs text-[var(--fg-tertiary)]">
                  {inits.length} initiative(s) · {tasks.length} task(s) · source {draft.source}
                </p>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate(draft.id)}
                  >
                    Approve &amp; commit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={reject.isPending}
                    onClick={() => reject.mutate(draft.id)}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
