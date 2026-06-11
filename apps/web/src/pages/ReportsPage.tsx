import { memo, useState } from 'react';

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
  const [tab, setTab] = useState<ReportTab>('pipeline');

  return (
    <div className="space-y-6">
      {/* The "New report" CTA pointed at the custom report-builder cluster
          (/reports/new, /api/reports*) whose backend does not exist yet, so it
          led to a broken page. Removed until that backend ships — the live
          pipeline/leads/service-desk/tasks reports below are fully functional. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Analytics across pipeline, leads, service desk, and tasks.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1" data-tour="reports-new">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-label={`${t.label} report tab`}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px] ${
              tab === t.key
                ? 'bg-[var(--fg-primary)] text-[var(--surface-page)]'
                : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            {t.label}
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
  const { formatMoney } = useFormatMoney();
  const { data, isLoading, isError, error } = usePipelineReport();

  if (isError) return <ErrorState title="Could not load report" message={error?.message} />;

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader title="Pipeline by stage" />
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
          label="Weighted pipeline"
          value={data ? formatMoney(data.weightedPipeline, 'EUR') : '—'}
        />
        <KpiCard label="Total open" value={data ? data.totalOpen.toString() : '—'} />
        <KpiCard
          label="Closed this quarter"
          value={data ? data.velocity.closedThisQuarter.toString() : '—'}
        />
      </div>
    </div>
  );
}

function LeadReport() {
  const { data, isLoading, isError, error } = useLeadReport();

  if (isError) return <ErrorState title="Could not load report" message={error?.message} />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-4">
        <KpiCard label="Total leads" value={data?.total.toString() ?? '—'} />
        <KpiCard label="Converted" value={data?.converted.toString() ?? '—'} />
        <KpiCard label="Conversion rate" value={data ? `${data.conversionRate}%` : '—'} />
        <KpiCard label="Avg score" value={data ? `${data.avgScore}` : '—'} />
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <Card>
          <SectionHeader title="By status" />
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
          <SectionHeader title="By source" />
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
  const { data, isLoading, isError, error } = useServiceDeskReport();

  if (isError) return <ErrorState title="Could not load report" message={error?.message} />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-4">
        <KpiCard label="Total cases" value={data?.total.toString() ?? '—'} />
        <KpiCard label="Open" value={data?.open.toString() ?? '—'} />
        <KpiCard label="Resolved this month" value={data?.resolvedThisMonth.toString() ?? '—'} />
        <KpiCard
          label="Avg satisfaction"
          value={data?.avgSatisfaction ? `${data.avgSatisfaction}/5` : '—'}
        />
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <Card>
          <SectionHeader title="By status" />
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
          <SectionHeader title="By priority" />
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
  const { data, isLoading, isError, error } = useTaskReport();

  if (isError) return <ErrorState title="Could not load report" message={error?.message} />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-4">
        <KpiCard label="Total tasks" value={data?.total.toString() ?? '—'} />
        <KpiCard label="Completed" value={data?.completed.toString() ?? '—'} />
        <KpiCard label="Overdue" value={data?.overdue.toString() ?? '—'} />
        <KpiCard label="Completion rate" value={data ? `${data.completionRate}%` : '—'} />
      </div>

      <Card>
        <SectionHeader title="By status" />
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
