import { Card, SectionHeader } from '@/components/ui/Card';

import type { CrmDashboardSnapshot } from '@bidstack/shared';

import { KPI_TONE_BG, KPI_TONE_FG, type KpiTone } from './_tokens';

interface Props {
  snapshot: CrmDashboardSnapshot;
  overdueCount: number;
  tasksLoading: boolean;
}

export function KpiSidebar({ snapshot, overdueCount, tasksLoading }: Props) {
  const queueWaiting = snapshot.queueHealth.reduce((acc, q) => acc + q.waiting + q.active, 0);
  const providers = snapshot.providerHealth.length;
  const healthyProviders = snapshot.providerHealth.filter((p) => p.status === 'healthy').length;

  return (
    <Card>
      <SectionHeader title="Platform pulse" caption="Live from BidStack APIs" />
      <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <PulseRow
          label="Release score"
          value={`${snapshot.releaseScore.total}/100`}
          tone={snapshot.releaseScore.passed ? 'jade' : 'amber'}
        />
        <PulseRow
          label="Providers healthy"
          value={`${healthyProviders}/${providers}`}
          tone={healthyProviders === providers ? 'jade' : 'amber'}
        />
        <PulseRow
          label="Queue backlog"
          value={queueWaiting.toString()}
          tone={queueWaiting > 50 ? 'rose' : queueWaiting > 0 ? 'amber' : 'jade'}
        />
        <PulseRow
          label="Overdue tasks"
          value={tasksLoading ? '...' : overdueCount.toString()}
          tone={overdueCount > 0 ? 'rose' : 'jade'}
        />
      </div>
    </Card>
  );
}

function PulseRow({ label, value, tone }: { label: string; value: string; tone: KpiTone }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '8px 12px',
        background: KPI_TONE_BG[tone],
        borderRadius: 10,
      }}
    >
      <span style={{ fontSize: 12.5, color: 'var(--fg-secondary)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: KPI_TONE_FG[tone] }}>{value}</span>
    </div>
  );
}
