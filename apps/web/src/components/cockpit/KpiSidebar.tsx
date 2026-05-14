import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties } from 'react';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Card, SectionHeader } from '@/components/ui/Card';
import { springSoft } from '@/lib/motion';

import type { CrmDashboardSnapshot } from '@bidstack/shared';

import { type KpiTone } from './_tokens';

interface Props {
  snapshot: CrmDashboardSnapshot;
  overdueCount: number;
  tasksLoading: boolean;
}

export function KpiSidebar({ snapshot, overdueCount, tasksLoading }: Props) {
  const reducedMotion = useReducedMotion();
  const queueWaiting = snapshot.queueHealth.reduce((acc, q) => acc + q.waiting + q.active, 0);
  const providers = snapshot.providerHealth.length;
  const healthyProviders = snapshot.providerHealth.filter((p) => p.status === 'healthy').length;

  return (
    <Card>
      <SectionHeader title="Platform pulse" caption="Live from BidStack APIs" />
      <div className="pulse-stack">
        <PulseRow
          label="Release score"
          value={`${snapshot.releaseScore.total}/100`}
          tone={snapshot.releaseScore.passed ? 'jade' : 'amber'}
          progress={snapshot.releaseScore.total}
          index={0}
          reducedMotion={Boolean(reducedMotion)}
        />
        <PulseRow
          label="Providers healthy"
          value={`${healthyProviders}/${providers}`}
          tone={healthyProviders === providers ? 'jade' : 'amber'}
          progress={providers ? (healthyProviders / providers) * 100 : 0}
          index={1}
          reducedMotion={Boolean(reducedMotion)}
        />
        <PulseRow
          label="Queue backlog"
          value={queueWaiting.toString()}
          tone={queueWaiting > 50 ? 'rose' : queueWaiting > 0 ? 'amber' : 'jade'}
          progress={Math.min(100, queueWaiting * 2)}
          index={2}
          reducedMotion={Boolean(reducedMotion)}
        />
        <PulseRow
          label="Overdue tasks"
          value={tasksLoading ? '...' : overdueCount.toString()}
          tone={overdueCount > 0 ? 'rose' : 'jade'}
          progress={Math.min(100, overdueCount * 18)}
          index={3}
          reducedMotion={Boolean(reducedMotion)}
        />
      </div>
    </Card>
  );
}

function PulseRow({
  label,
  value,
  tone,
  progress,
  index,
  reducedMotion,
}: {
  label: string;
  value: string;
  tone: KpiTone;
  progress: number;
  index: number;
  reducedMotion: boolean;
}) {
  return (
    <motion.div
      className={`pulse-row pulse-row-${tone}`}
      style={{ '--pulse-fill': `${Math.max(0, Math.min(100, progress))}%` } as CSSProperties}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
    >
      <span>{label}</span>
      <strong>
        {value.includes('/') || value === '...' ? value : <AnimatedMetric value={value} />}
      </strong>
    </motion.div>
  );
}
