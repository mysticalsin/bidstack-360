import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge, stageTone } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { formatMoney, formatStage } from '@/lib/format';

export function ReportsPage() {
  const { data, isLoading } = usePipelineReport();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">Pipeline KPIs and velocity.</p>
      </header>

      <Card>
        <SectionHeader title="Pipeline by stage" />
        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          <div className="p-5 space-y-3">
            {data?.byStage.map((s) => {
              const max = Math.max(...(data?.byStage.map((x) => x.valueSum) ?? [1]));
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
                    <div className="h-full bg-[var(--brand-primary)]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
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

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-[var(--fg-primary)]">{value}</div>
    </Card>
  );
}
