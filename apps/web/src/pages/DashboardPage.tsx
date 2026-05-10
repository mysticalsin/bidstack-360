import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge, stageTone } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { Button } from '@/components/ui/Button';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { useTasks } from '@/hooks/useTasks';
import { formatMoney, formatStage, daysUntil } from '@/lib/format';

export function DashboardPage() {
  const report = usePipelineReport();
  const opps = useOpportunities({ limit: 5 });
  const tasks = useTasks();

  const overdueCount =
    tasks.data?.items.filter((t) => {
      const d = daysUntil(t.dueDate);
      return d !== null && d < 0 && t.status !== 'done';
    }).length ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          A 360° view of your bid portfolio.
        </p>
      </header>

      <section
        aria-label="Key metrics"
        className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      >
        <KpiCard
          label="Open opportunities"
          value={report.data?.totalOpen.toString() ?? '—'}
          loading={report.isLoading}
        />
        <KpiCard
          label="Pipeline value"
          value={
            report.data ? formatMoney(report.data.totalValueOpen, 'EUR') : '—'
          }
          loading={report.isLoading}
        />
        <KpiCard
          label="Weighted pipeline"
          value={
            report.data ? formatMoney(report.data.weightedPipeline, 'EUR') : '—'
          }
          loading={report.isLoading}
        />
        <KpiCard
          label="Overdue tasks"
          value={overdueCount.toString()}
          tone={overdueCount > 0 ? 'tomato' : 'jade'}
          loading={tasks.isLoading}
        />
      </section>

      <section className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeader
            title="Recent opportunities"
            action={
              <Button variant="secondary" size="sm">
                View all
              </Button>
            }
          />
          {opps.isLoading ? (
            <LoadingSkeleton />
          ) : opps.isError ? (
            <ErrorState
              title="Couldn't load opportunities"
              message={opps.error?.message ?? 'Unknown error'}
            />
          ) : opps.data?.items.length === 0 ? (
            <EmptyState title="No opportunities yet" />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {opps.data?.items.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-[var(--surface-sunken)] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[var(--fg-tertiary)]">
                        {o.code}
                      </span>
                      <Badge tone={stageTone(o.stage)}>{formatStage(o.stage)}</Badge>
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-[var(--fg-primary)]">
                      {o.name}
                    </div>
                    <div className="text-xs text-[var(--fg-secondary)]">{o.customer}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-[var(--fg-primary)] tabular-nums">
                      {formatMoney(o.value, 'EUR')}
                    </div>
                    <div className="text-xs text-[var(--fg-tertiary)]">
                      {o.probability}% likely
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader title="Pipeline by stage" />
          <div className="p-5 space-y-3">
            {report.data?.byStage.map((s) => (
              <div key={s.stage} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge tone={stageTone(s.stage)}>{formatStage(s.stage)}</Badge>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-[var(--fg-primary)] tabular-nums">
                    {s.count}
                  </div>
                  <div className="text-[10px] text-[var(--fg-tertiary)] tabular-nums">
                    {formatMoney(s.valueSum, 'EUR')}
                  </div>
                </div>
              </div>
            ))}
            {!report.data ? <LoadingSkeleton rows={6} /> : null}
          </div>
        </Card>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone = 'gray',
  loading,
}: {
  label: string;
  value: string;
  tone?: 'gray' | 'tomato' | 'jade';
  loading?: boolean;
}) {
  const valueColor =
    tone === 'tomato'
      ? 'text-[var(--danger)]'
      : tone === 'jade'
        ? 'text-[var(--success)]'
        : 'text-[var(--fg-primary)]';
  return (
    <Card className="px-5 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${valueColor}`}>
        {loading ? <span className="inline-block h-7 w-20 rounded bg-[var(--surface-sunken)] animate-pulse" /> : value}
      </div>
    </Card>
  );
}
