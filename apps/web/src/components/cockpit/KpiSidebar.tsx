import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

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

export const KpiSidebar = memo(function KpiSidebar({
  snapshot,
  overdueCount,
  tasksLoading,
  account = false,
}: Props & { account?: boolean }) {
  const { t } = useTranslation('crm');
  const reducedMotion = useReducedMotion();
  const queuesChecked = snapshot.queueHealth.length > 0;
  const queueWaiting = snapshot.queueHealth.reduce((acc, q) => acc + q.waiting + q.active, 0);
  const providers = snapshot.providerHealth.length;
  const healthyProviders = snapshot.providerHealth.filter((p) => p.status === 'healthy').length;
  const release = snapshot.releaseScore;
  const releaseUnset =
    release.functional === 0 && release.code === 0 && release.design === 0 && release.infra === 0;

  return (
    <Card>
      <SectionHeader
        title={
          account
            ? t('kpiSidebar.accountTitle', 'Tasks on this account')
            : t('kpiSidebar.title', 'Platform status')
        }
        caption={
          account
            ? t('kpiSidebar.accountCaption', 'Open work for this account. Not a workspace health probe.')
            : t(
                'kpiSidebar.caption',
                'Catalog and stored samples for this workspace. Not a live integration probe.',
              )
        }
      />
      <div className="pulse-stack">
        {account ? null : (
        <>
        <PulseRow
          label={
            releaseUnset
              ? t('kpiSidebar.releaseScoreUnset', 'Release score unset')
              : t('kpiSidebar.releaseScore', 'Release score, stored rubric')
          }
          value={releaseUnset ? t('kpiSidebar.releaseScoreNone', 'no stored score') : `${release.total}/100`}
          tone={releaseUnset ? 'amber' : release.passed ? 'jade' : 'amber'}
          progress={releaseUnset ? 0 : release.total}
          index={0}
          reducedMotion={Boolean(reducedMotion)}
        />
        <PulseRow
          label={t('kpiSidebar.providersHealthy', 'Providers marked healthy')}
          value={`${healthyProviders}/${providers}`}
          tone="amber"
          progress={providers ? (healthyProviders / providers) * 100 : 0}
          index={1}
          reducedMotion={Boolean(reducedMotion)}
        />
        <PulseRow
          label={t('kpiSidebar.queueBacklog', 'Queue backlog')}
          value={
            queuesChecked
              ? queueWaiting.toString()
              : t('kpiSidebar.queueNotChecked', 'not checked')
          }
          tone={queuesChecked ? (queueWaiting > 50 ? 'rose' : queueWaiting > 0 ? 'amber' : 'jade') : 'amber'}
          progress={queuesChecked ? Math.min(100, queueWaiting * 2) : 0}
          index={2}
          reducedMotion={Boolean(reducedMotion)}
        />
        </>
        )}
        <PulseRow
          label={t('kpiSidebar.overdueTasks', 'Overdue tasks')}
          value={tasksLoading ? '...' : overdueCount.toString()}
          tone={overdueCount > 0 ? 'rose' : 'jade'}
          progress={Math.min(100, overdueCount * 18)}
          index={3}
          reducedMotion={Boolean(reducedMotion)}
        />
      </div>
    </Card>
  );
});

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
