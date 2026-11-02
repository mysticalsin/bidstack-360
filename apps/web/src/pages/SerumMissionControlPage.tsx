import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { SerumModuleStatus, SerumStatusCard } from '@bidstack/shared';

import {
  SerumApprovalCard,
  SerumAuditDrawer,
  SerumCommandBar,
  SerumEmptyState,
  SerumErrorState,
  SerumInspector,
  SerumMetricCard,
  SerumPanel,
  SerumSourceCard,
  SerumSplitView,
  SerumStatusPill,
} from '@/components/serum/SerumGlass';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useSerumStatus } from '@/hooks/useSerumStatus';
import { cn } from '@/lib/cn';

const CARD_ICONS: Record<string, IconName> = {
  enabled: 'sparkle',
  agents: 'contacts',
  loops: 'pipeline',
  documents: 'file',
  approvals: 'shield',
  models: 'zap',
};

const MODULE_ICONS: Record<string, IconName> = {
  'mission-control': 'dashboard',
  'document-intelligence': 'file',
  'agent-loops': 'pipeline',
  'model-router': 'zap',
  'dust-mcp': 'webhook',
  'memory-patterns': 'book',
  evals: 'checkCircle',
};

export function SerumMissionControlPage() {
  const { t } = useTranslation('crm');
  const status = useSerumStatus();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const snapshot = status.data;
  const selectedModule = useMemo<SerumModuleStatus | null>(() => {
    if (!snapshot) return null;
    return snapshot.modules.find((module) => module.id === selectedId) ?? snapshot.modules[0] ?? null;
  }, [selectedId, snapshot]);

  if (status.isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton rows={8} />
      </div>
    );
  }

  if (status.isError || !snapshot) {
    return <SerumErrorState error={status.error} onRetry={() => void status.refetch()} />;
  }

  return (
    <div className="space-y-6 pb-8">
      <header className="overflow-hidden rounded-3xl border border-[var(--serum-border)] bg-[var(--serum-surface)] p-6 shadow-[var(--serum-shadow-md)] backdrop-blur-xl lg:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--serum-blue)]">
              <Icon name="sparkle" size={14} ariaHidden />
              {t('serum.eyebrow', 'Self-Evolving Revenue Understanding Mesh')}
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[var(--fg-primary)] lg:text-5xl">
              {t('serum.title', 'SERUM Mission Control')}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--fg-secondary)] lg:text-base">
              {t(
                'serum.subtitle',
                'A source-backed control plane for agents, documents, model routing, approvals, and observability.',
              )}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <SerumStatusPill status={snapshot.enabled ? 'ready' : 'disabled'} />
              <span className="text-xs text-[var(--fg-tertiary)]">
                {t('serum.updatedAt', 'Updated {{time}}', {
                  time: new Date(snapshot.generatedAt).toLocaleString(),
                })}
              </span>
            </div>
          </div>
          <SerumCommandBar onRefresh={() => void status.refetch()} refreshing={status.isFetching} />
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.cards.map((card: SerumStatusCard) => (
          <SerumMetricCard key={card.id} card={card} icon={CARD_ICONS[card.id] ?? 'dashboard'} />
        ))}
      </div>

      <SerumSplitView>
        <SerumPanel className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                {t('serum.moduleMapEyebrow', 'Live module map')}
              </p>
              <h2 className="mt-2 text-lg font-semibold tracking-tight text-[var(--fg-primary)]">
                {t('serum.moduleMapTitle', 'Control-plane readiness')}
              </h2>
            </div>
            <Link
              to="/agent-studio"
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-medium text-[var(--fg-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
            >
              <Icon name="sparkle" size={14} ariaHidden />
              {t('serum.agentStudioLink', 'Agent Studio')}
            </Link>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {snapshot.modules.map((module) => (
              <button
                key={module.id}
                type="button"
                onClick={() => setSelectedId(module.id)}
                className={cn(
                  'group flex min-h-[132px] w-full flex-col justify-between rounded-2xl border p-4 text-left transition-all',
                  selectedModule?.id === module.id
                    ? 'border-[var(--serum-blue)] bg-[var(--serum-surface-solid)] shadow-[var(--serum-shadow-sm)]'
                    : 'border-[var(--serum-border)] bg-[var(--serum-surface-soft)] hover:border-[var(--border-strong)] hover:bg-[var(--serum-surface-solid)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--serum-surface-solid)] text-[var(--serum-blue)] shadow-[var(--serum-shadow-sm)]">
                    <Icon name={MODULE_ICONS[module.id] ?? 'dashboard'} size={18} ariaHidden />
                  </div>
                  <SerumStatusPill status={module.status} />
                </div>
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{module.label}</h3>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--fg-secondary)]">
                    {module.detail}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </SerumPanel>

        <div className="space-y-5">
          <SerumInspector module={selectedModule} />
          <SerumApprovalCard openApprovals={snapshot.summary.openApprovals} />
          <SerumAuditDrawer latestConfigChangeAt={snapshot.summary.latestConfigChangeAt} />
        </div>
      </SerumSplitView>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SerumPanel className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                {t('serum.eventFeedEyebrow', 'Event feed')}
              </p>
              <h2 className="mt-2 text-lg font-semibold tracking-tight text-[var(--fg-primary)]">
                {t('serum.eventFeedTitle', 'Durable SERUM events')}
              </h2>
            </div>
            <SerumStatusPill status="not_configured" />
          </div>
          <div className="mt-5">
            <SerumEmptyState
              title={t('serum.eventFeedEmptyTitle', 'No SERUM event ledger yet')}
              detail={t(
                'serum.eventFeedEmptyDetail',
                'The current build reads existing Crew, RFP, document, provider, queue, and audit signals. A future append-only SERUM event table should power live replay before autonomous loops are exposed.',
              )}
            />
          </div>
        </SerumPanel>

        <SerumPanel className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
            {t('serum.guardrailsTitle', 'Guardrails')}
          </p>
          <div className="mt-4 space-y-3">
            {snapshot.guardrails.map((guardrail) => (
              <div key={guardrail} className="flex items-start gap-3 text-sm leading-6 text-[var(--fg-secondary)]">
                <Icon name="shield" size={16} className="mt-1 shrink-0 text-[var(--serum-blue)]" ariaHidden />
                <span>{guardrail}</span>
              </div>
            ))}
          </div>
        </SerumPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SerumSourceCard
          icon="pipeline"
          label={t('serum.loopSourcesLabel', 'Loop sources')}
          detail={t(
            'serum.loopSourcesDetail',
            '{{count}} active loops from Crew runs and RFP orchestrations.',
            { count: snapshot.summary.activeLoops },
          )}
        />
        <SerumSourceCard
          icon="file"
          label={t('serum.documentSourcesLabel', 'Document sources')}
          detail={t(
            'serum.documentSourcesDetail',
            '{{processed}} successful extractions today; {{failed}} failed job signals across queues, documents, and RFP loops.',
            {
              processed: snapshot.summary.documentsProcessedToday,
              failed: snapshot.summary.failedJobs,
            },
          )}
        />
        <SerumSourceCard
          icon="zap"
          label={t('serum.modelSourcesLabel', 'Model sources')}
          detail={t(
            'serum.modelSourcesDetail',
            '{{calls}} AI invocation audit rows today with {{tokens}} tokens.',
            {
              calls: snapshot.summary.modelCallsToday,
              tokens: snapshot.summary.modelTokensToday.toLocaleString('en-US'),
            },
          )}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SerumPanel className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[var(--fg-primary)]">
              {t('serum.providerHealthTitle', 'Provider health')}
            </h2>
            <SerumStatusPill status={snapshot.summary.providerConfigured || snapshot.summary.dustConfigured ? 'ready' : 'not_configured'} />
          </div>
          <div className="mt-4 space-y-3">
            {snapshot.providerHealth.length > 0 ? (
              snapshot.providerHealth.map((provider) => (
                <div
                  key={provider.provider}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--fg-primary)]">{provider.provider}</p>
                    <p className="text-xs text-[var(--fg-tertiary)]">
                      {provider.latencyMs === null
                        ? t('serum.noLatencyRecorded', 'No latency recorded')
                        : t('serum.latencyMs', '{{ms}} ms', { ms: provider.latencyMs })}
                    </p>
                  </div>
                  <SerumStatusPill status={provider.status} />
                </div>
              ))
            ) : (
              <SerumEmptyState
                title={t('serum.providerEmptyTitle', 'No provider heartbeat rows')}
                detail={t(
                  'serum.providerEmptyDetail',
                  'Provider credentials may still exist, but no health checks have been written for this org.',
                )}
              />
            )}
          </div>
        </SerumPanel>

        <SerumPanel className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[var(--fg-primary)]">
              {t('serum.queueHealthTitle', 'Queue health')}
            </h2>
            <SerumStatusPill status={snapshot.queueHealth.some((queue) => queue.failed > 0) ? 'attention' : 'ready'} />
          </div>
          <div className="mt-4 space-y-3">
            {snapshot.queueHealth.length > 0 ? (
              snapshot.queueHealth.map((queue) => (
                <div
                  key={queue.queueName}
                  className="rounded-xl border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-[var(--fg-primary)]">{queue.queueName}</p>
                    <SerumStatusPill status={queue.status} />
                  </div>
                  <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
                    {t(
                      'serum.queueCounts',
                      '{{waiting}} waiting / {{active}} active / {{failed}} failed / {{completed}} completed',
                      {
                        waiting: queue.waiting,
                        active: queue.active,
                        failed: queue.failed,
                        completed: queue.completed,
                      },
                    )}
                  </p>
                </div>
              ))
            ) : (
              <SerumEmptyState
                title={t('serum.queueEmptyTitle', 'No queue snapshots')}
                detail={t(
                  'serum.queueEmptyDetail',
                  'Queue monitor rows have not been recorded yet for this org.',
                )}
              />
            )}
          </div>
        </SerumPanel>
      </div>

      <SerumPanel className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
              {t('serum.backendSignalsEyebrow', 'Backend signals')}
            </p>
            <h2 className="mt-2 text-base font-semibold text-[var(--fg-primary)]">
              {t('serum.backendSignalsTitle', 'Signal availability')}
            </h2>
          </div>
          <SerumStatusPill
            status={
              snapshot.signalHealth.some((signal) => signal.status === 'blocked' || signal.status === 'error')
                ? 'blocked'
                : snapshot.signalHealth.some((signal) => signal.status === 'attention')
                  ? 'attention'
                  : 'ready'
            }
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {snapshot.signalHealth.map((signal) => (
            <div
              key={signal.id}
              className="rounded-xl border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--fg-primary)]">{signal.label}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--fg-tertiary)]">{signal.detail}</p>
                </div>
                <SerumStatusPill status={signal.status} />
              </div>
            </div>
          ))}
        </div>
      </SerumPanel>
    </div>
  );
}
