import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Card, SectionHeader } from '@/components/ui/Card';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { relativeTime } from '@/lib/format';
import { springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { headquartersFor, labelForBand } from './_tokens';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

// Memoized — see TechStackCard for the rationale (stable cockpit prop;
// avoids re-render churn when sibling cards refetch).
export const BusinessSnapshotCard = memo(function BusinessSnapshotCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const { formatMoney } = useFormatMoney();
  const { t } = useTranslation('crm');
  const c = cockpit.company;
  const headquarters = headquartersFor(c.name);
  const sourceCount = c.sourceAttribution.length;
  const notVerified = t('businessSnapshot.value.notVerified', 'Not verified');
  const strategic = c.strategicIntel;
  const intentSummary = strategic?.intentTopics.length
    ? strategic.intentTopics.slice(0, 3).join(', ')
    : notVerified;
  const hiringSummary = strategic
    ? t('businessSnapshot.value.hiringSummary', '{{trend}} ({{count}} signals)', {
        trend: strategic.employeeTrend,
        count: strategic.hiringSignals.length,
      })
    : notVerified;
  const leadershipSummary = strategic?.leadershipSignals.length
    ? t('businessSnapshot.value.leadershipSummary', '{{count}} C-level signals', {
        count: strategic.leadershipSignals.length,
      })
    : notVerified;
  const rows: Array<[string, string]> = [
    [t('businessSnapshot.row.legalName', 'Legal name'), c.legalName ?? c.name],
    [
      t('businessSnapshot.row.founded', 'Founded'),
      c.incorporationDate ? c.incorporationDate.slice(0, 4) : notVerified,
    ],
    [t('businessSnapshot.row.headquarters', 'Headquarters'), headquarters ?? notVerified],
    [
      t('businessSnapshot.row.annualRevenue', 'Annual revenue'),
      c.annualRevenueMicros
        ? formatMoney(c.annualRevenueMicros / 1_000_000, 'EUR')
        : notVerified,
    ],
    [
      t('businessSnapshot.row.employees', 'Employees'),
      c.employeeCount ? c.employeeCount.toLocaleString() : notVerified,
    ],
    [t('businessSnapshot.row.intentTopics', 'Intent topics'), intentSummary],
    [t('businessSnapshot.row.hiringMovement', 'Hiring movement'), hiringSummary],
    [t('businessSnapshot.row.leadershipChanges', 'Leadership changes'), leadershipSummary],
    [
      t('businessSnapshot.row.externalSync', 'External sync'),
      strategic?.lastSyncedAt
        ? `${strategic.freshness} - ${relativeTime(strategic.lastSyncedAt)}`
        : t('businessSnapshot.value.notSynced', 'Not synced'),
    ],
    [
      t('businessSnapshot.row.sourceReceipts', 'Source receipts'),
      sourceCount === 1
        ? t('businessSnapshot.value.sourceCount_one', '{{count}} source', { count: sourceCount })
        : t('businessSnapshot.value.sourceCount_other', '{{count}} sources', { count: sourceCount }),
    ],
    [t('businessSnapshot.row.lastRefreshed', 'Last refreshed'), relativeTime(c.updatedAt)],
    [t('businessSnapshot.row.confidence', 'Confidence'), `${Math.round(c.confidence * 100)}%`],
  ];
  return (
    <Card role="region" aria-label={t('businessSnapshot.region.ariaLabel', 'Business snapshot')}>
      <SectionHeader
        title={t('businessSnapshot.title', 'Business snapshot')}
        caption={t('businessSnapshot.caption', 'Health: {{band}} - score {{score}}/100', {
          band: labelForBand(cockpit.health.band),
          score: cockpit.health.score,
        })}
      />
      <div style={{ padding: '14px 18px 18px' }}>
        <dl className="kvlist">
          {rows.map(([label, value], index) => (
            <motion.div
              key={label}
              className="kv"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.032 }}
            >
              <dt>{label}</dt>
              <dd>
                <AnimatedMetric value={value} />
              </dd>
            </motion.div>
          ))}
        </dl>
      </div>
    </Card>
  );
});
