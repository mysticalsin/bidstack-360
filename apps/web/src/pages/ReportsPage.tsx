import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge, stageTone } from '@/components/ui/Badge';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import {
  usePipelineReport,
  useLeadReport,
  useServiceDeskReport,
  useTaskReport,
} from '@/hooks/useReports';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { formatStage } from '@/lib/format';

type ReportTab = 'pipeline' | 'leads' | 'service-desk' | 'tasks';

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'leads', label: 'Leads' },
  { key: 'service-desk', label: 'Service Desk' },
  { key: 'tasks', label: 'Tasks' },
];

export function ReportsPage() {
  const { t } = useTranslation('reports');
  const [tab, setTab] = useState<ReportTab>('pipeline');

  const tabLabel = (key: ReportTab, label: string) =>
    t(`reports.tab.${key}`, label);

  return (
    <div className="space-y-6">
      {/* Legacy canned-stats view (pipeline/leads/service-desk/tasks). The
          custom report builder now lives at /reports/list -> /reports/new
          (the canonical "Reports" nav destination); this page is kept for its
          fixed operational dashboards and is still reachable by URL. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            {t('reports.heading', 'Reports')}
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {t('reports.subtitle', 'Analytics across pipeline, leads, service desk, and tasks.')}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1" data-tour="reports-new">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            aria-label={t('reports.tabAriaLabel', '{{label}} report tab', {
              label: tabLabel(tabItem.key, tabItem.label),
            })}
            aria-pressed={tab === tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px] ${
              tab === tabItem.key
                ? 'bg-[var(--fg-primary)] text-[var(--surface-page)]'
                : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            {tabLabel(tabItem.key, tabItem.label)}
          </button>
        ))}
      </div>

      {tab === 'pipeline' && <PipelineReport />}
      {tab === 'leads' && <LeadReport />}
      {tab === 'service-desk' && <ServiceDeskReport />}
      {tab === 'tasks' && <TaskReport />}
    </div>
  );
}

function PipelineReport() {
  const { t } = useTranslation('reports');
  const { formatMoney } = useFormatMoney();
  const { data, isLoading, isError, error } = usePipelineReport();

  if (isError)
    return (
      <ErrorState
        title={t('reports.error.title', 'Could not load report')}
        message={error?.message}
      />
    );

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader title={t('reports.pipeline.byStage', 'Pipeline by stage')} />
        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          <div className="p-5 space-y-3">
            {(() => {
              const max = Math.max(...(data?.byStage.map((x) => x.valueSum) ?? [1]));
              return data?.byStage.map((s) => {
                const pct = (s.valueSum / max) * 100;
                return (
                  <div key={s.stage}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <Badge tone={stageTone(s.stage)}>{formatStage(s.stage)}</Badge>
                      <span className="tabular-nums text-[var(--fg-secondary)]">
                        {s.count} · {formatMoney(s.valueSum, 'EUR')}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--brand-primary)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </Card>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <KpiCard
          label={t('reports.pipeline.weighted', 'Weighted pipeline')}
          value={data ? formatMoney(data.weightedPipeline, 'EUR') : '—'}
        />
        <KpiCard
          label={t('reports.pipeline.totalOpen', 'Total open')}
          value={data ? data.totalOpen.toString() : '—'}
        />
        <KpiCard
          label={t('reports.pipeline.closedThisQuarter', 'Closed this quarter')}
          value={data ? data.velocity.closedThisQuarter.toString() : '—'}
        />
      </div>
    </div>
  );
}

function LeadReport() {
  const { t } = useTranslation('reports');
  const { data, isLoading, isError, error } = useLeadReport();

  if (isError)
    return (
      <ErrorState
        title={t('reports.error.title', 'Could not load report')}
        message={error?.message}
      />
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-4">
        <KpiCard label={t('reports.leads.total', 'Total leads')} value={data?.total.toString() ?? '—'} />
        <KpiCard label={t('reports.leads.converted', 'Converted')} value={data?.converted.toString() ?? '—'} />
        <KpiCard label={t('reports.leads.conversionRate', 'Conversion rate')} value={data ? `${data.conversionRate}%` : '—'} />
        <KpiCard label={t('reports.leads.avgScore', 'Avg score')} value={data ? `${data.avgScore}` : '—'} />
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <Card>
          <SectionHeader title={t('reports.byStatus', 'By status')} />
          {isLoading ? (
            <LoadingSkeleton />
          ) : (
            <div className="p-5 space-y-3">
              {(() => {
                const max = Math.max(...(data?.byStatus.map((x) => x.count) ?? [1]));
                return data?.byStatus.map((s) => {
                  const pct = (s.count / max) * 100;
                  return (
                    <div key={s.status}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="capitalize">{s.status}</span>
                        <span className="tabular-nums text-[var(--fg-secondary)]">{s.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                        <div
                          className="h-full bg-[var(--brand-primary)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader title={t('reports.leads.bySource', 'By source')} />
          {isLoading ? (
            <LoadingSkeleton />
          ) : (
            <div className="p-5 space-y-3">
              {(() => {
                const max = Math.max(...(data?.bySource.map((x) => x.count) ?? [1]));
                return data?.bySource.map((s) => {
                  const pct = (s.count / max) * 100;
                  return (
                    <div key={s.source}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="capitalize">{s.source}</span>
                        <span className="tabular-nums text-[var(--fg-secondary)]">{s.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                        <div
                          className="h-full bg-[var(--brand-primary)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ServiceDeskReport() {
  const { t } = useTranslation('reports');
  const { data, isLoading, isError, error } = useServiceDeskReport();

  if (isError)
    return (
      <ErrorState
        title={t('reports.error.title', 'Could not load report')}
        message={error?.message}
      />
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-4">
        <KpiCard label={t('reports.serviceDesk.totalCases', 'Total cases')} value={data?.total.toString() ?? '—'} />
        <KpiCard label={t('reports.serviceDesk.open', 'Open')} value={data?.open.toString() ?? '—'} />
        <KpiCard label={t('reports.serviceDesk.resolvedThisMonth', 'Resolved this month')} value={data?.resolvedThisMonth.toString() ?? '—'} />
        <KpiCard
          label={t('reports.serviceDesk.avgSatisfaction', 'Avg satisfaction')}
          value={data?.avgSatisfaction ? `${data.avgSatisfaction}/5` : '—'}
        />
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <Card>
          <SectionHeader title={t('reports.byStatus', 'By status')} />
          {isLoading ? (
            <LoadingSkeleton />
          ) : (
            <div className="p-5 space-y-3">
              {(() => {
                const max = Math.max(...(data?.byStatus.map((x) => x.count) ?? [1]));
                return data?.byStatus.map((s) => {
                  const pct = (s.count / max) * 100;
                  return (
                    <div key={s.status}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="capitalize">{s.status}</span>
                        <span className="tabular-nums text-[var(--fg-secondary)]">{s.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                        <div
                          className="h-full bg-[var(--brand-primary)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader title={t('reports.serviceDesk.byPriority', 'By priority')} />
          {isLoading ? (
            <LoadingSkeleton />
          ) : (
            <div className="p-5 space-y-3">
              {(() => {
                const max = Math.max(...(data?.byPriority.map((x) => x.count) ?? [1]));
                return data?.byPriority.map((p) => {
                  const pct = (p.count / max) * 100;
                  return (
                    <div key={p.priority}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="capitalize">{p.priority}</span>
                        <span className="tabular-nums text-[var(--fg-secondary)]">{p.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                        <div
                          className="h-full bg-[var(--brand-primary)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function TaskReport() {
  const { t } = useTranslation('reports');
  const { data, isLoading, isError, error } = useTaskReport();

  if (isError)
    return (
      <ErrorState
        title={t('reports.error.title', 'Could not load report')}
        message={error?.message}
      />
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-4">
        <KpiCard label={t('reports.tasks.total', 'Total tasks')} value={data?.total.toString() ?? '—'} />
        <KpiCard label={t('reports.tasks.completed', 'Completed')} value={data?.completed.toString() ?? '—'} />
        <KpiCard label={t('reports.tasks.overdue', 'Overdue')} value={data?.overdue.toString() ?? '—'} />
        <KpiCard label={t('reports.tasks.completionRate', 'Completion rate')} value={data ? `${data.completionRate}%` : '—'} />
      </div>

      <Card>
        <SectionHeader title={t('reports.byStatus', 'By status')} />
        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          <div className="p-5 space-y-3">
            {(() => {
              const max = Math.max(...(data?.byStatus.map((x) => x.count) ?? [1]));
              return data?.byStatus.map((s) => {
                const pct = (s.count / max) * 100;
                return (
                  <div key={s.status}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="capitalize">{s.status}</span>
                      <span className="tabular-nums text-[var(--fg-secondary)]">{s.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--brand-primary)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </Card>
    </div>
  );
}

const KpiCard = memo(function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-[var(--fg-primary)]">{value}</div>
    </Card>
  );
});
