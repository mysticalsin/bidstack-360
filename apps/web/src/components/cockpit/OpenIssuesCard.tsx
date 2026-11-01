import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateMessages';
import { springSoft } from '@/lib/motion';

import type { ComplianceCheck, RiskItem } from '@bidstack/shared';

import { severityBg, severityShort, severityTone } from './_tokens';
import {
  openRiskHeadline,
  severityBucketCounts,
  type OpenRiskSeverityCounts,
} from './open-risk-headline';

/** The caption names risks and checks separately so it matches the risk mix. */
export function openIssuesCaption(input: {
  recorded: number;
  openRisks: number;
  openChecks: number;
  pageCapped: boolean;
}): { key: string; text: string } {
  const total = input.openRisks + input.openChecks;
  if (input.recorded === 0 && total === 0) {
    return {
      key: 'openIssues.captionNoneRecorded',
      text: 'No risks or compliance checks recorded on this account',
    };
  }
  if (total === 0) {
    return input.pageCapped
      ? {
          key: 'openIssues.captionNoneOpenPage',
          text: 'No open items in the latest 50 rows. Older rows are outside this page.',
        }
      : {
          key: 'openIssues.captionNoneOpen',
          text: 'No open items in the recorded register',
        };
  }
  const parts: string[] = [];
  if (input.openRisks > 0) {
    parts.push(`${input.openRisks} open risk${input.openRisks === 1 ? '' : 's'}`);
  }
  if (input.openChecks > 0) {
    parts.push(`${input.openChecks} open check${input.openChecks === 1 ? '' : 's'}`);
  }
  const body = parts.join(' and ');
  return input.pageCapped
    ? { key: 'openIssues.captionSplitPage', text: `Latest 50 rows. ${body} on the account.` }
    : { key: 'openIssues.captionSplit', text: body };
}

interface Props {
  risks: RiskItem[];
  compliance: ComplianceCheck[];
  openRiskCount?: number;
  openComplianceCount?: number;
  openRiskSeverity?: OpenRiskSeverityCounts;
  risksCapped?: boolean;
  complianceCapped?: boolean;
}

// Memoized — render is pure on risks+compliance arrays, both stable per
// snapshot fetch. Avoids re-render when sibling cards refetch.
export const OpenIssuesCard = memo(function OpenIssuesCard({
  risks,
  compliance,
  openRiskCount,
  openComplianceCount,
  openRiskSeverity,
  risksCapped,
  complianceCapped,
}: Props) {
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');
  const openRisks = risks.filter((r) => r.status === 'open' || r.status === 'in_progress');
  const openCompliance = compliance.filter(
    (c) => c.status === 'blocked' || c.status === 'in_progress' || c.status === 'not_started',
  );
  const riskTotal = openRiskCount ?? openRisks.length;
  const checkTotal = openComplianceCount ?? openCompliance.length;
  const total = riskTotal + checkTotal;
  const recorded = risks.length + compliance.length;
  const pageCapped = Boolean(risksCapped || complianceCapped);
  const caption = openIssuesCaption({
    recorded,
    openRisks: riskTotal,
    openChecks: checkTotal,
    pageCapped,
  });
  // Register counts are open risks on the loaded deals. Without them, the
  // visible rows are the only book.
  const severity = severityBucketCounts(openRisks, openRiskSeverity);
  const unranked = openRiskHeadline({
    risks,
    openRiskCount,
    openRiskSeverity,
  }).unranked;
  const rankedOpen = severity.critical + severity.high + severity.medium + severity.low;
  const showRiskMix = recorded > 0 || unranked > 0 || rankedOpen > 0;
  const buckets = [
    {
      label: 'Critical',
      labelText: t('openIssues.severityCritical', 'Critical'),
      count: severity.critical,
      tone: 'tomato',
    },
    {
      label: 'High',
      labelText: t('openIssues.severityHigh', 'High'),
      count: severity.high,
      tone: 'amber',
    },
    {
      label: 'Medium',
      labelText: t('openIssues.severityMedium', 'Medium'),
      count: severity.medium,
      tone: 'blue',
    },
    {
      label: 'Low',
      labelText: t('openIssues.severityLow', 'Low'),
      count: severity.low,
      tone: 'gray',
    },
    ...(unranked > 0
      ? [
          {
            label: 'Unranked',
            labelText: t('openIssues.severityUnranked', 'Unranked'),
            count: unranked,
            tone: 'gray' as const,
          },
        ]
      : []),
  ] as const;

  return (
    <Card role="region" aria-label={t('openIssues.regionLabel', 'Open issues by severity')}>
      <SectionHeader
        title={t('openIssues.title', 'Open issues')}
        caption={t(caption.key, caption.text)}
      />
      <div style={{ padding: '8px 18px 14px' }}>
        {showRiskMix ? (
        <div className="issue-buckets" aria-label={t('openIssues.bucketsLabel', 'Severity buckets')}>
          {buckets.map((bucket, index) => (
            <motion.div
              key={bucket.label}
              className="issue-bucket"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.035 }}
            >
              <Badge tone={bucket.tone}>{bucket.labelText}</Badge>
              <strong>
                <AnimatedMetric value={bucket.count.toLocaleString()} />
              </strong>
            </motion.div>
          ))}
        </div>
        ) : null}
        {total === 0 ? (
          <EmptyState
            icon="warning"
            title={
              recorded === 0
                ? t('openIssues.emptyTitle', 'Nothing recorded')
                : t('openIssues.noneOpenTitle', 'No open items')
            }
            message={
              recorded === 0
                ? t(
                    'openIssues.emptyMessage',
                    'This account has no risk or compliance rows. That is not a clearance.',
                  )
                : t(
                    'openIssues.noneOpenMessage',
                    'The recorded register has no open risks or compliance checks.',
                  )
            }
          />
        ) : (
          <ul className="open-issues">
            {openRisks.slice(0, 4).map((r, index) => (
              <motion.li
                key={r.id}
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
              >
                <span className="oi-count" style={{ background: severityBg(r.severity) }}>
                  {severityShort(r.severity)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-primary)' }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-tertiary)' }}>
                    {r.owner ?? t('openIssues.unassigned', 'Unassigned')}
                    {r.dueDate ? t('openIssues.dueSuffix', ' - due {{dueDate}}', { dueDate: r.dueDate }) : ''}
                  </div>
                </div>
                <Badge tone={severityTone(r.severity)}>
                  {r.severity ?? t('openIssues.severityUnspecified', 'Unspecified')}
                </Badge>
              </motion.li>
            ))}
            {openCompliance.slice(0, 2).map((c, index) => (
              <motion.li
                key={c.id}
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  ...springSoft,
                  delay: reducedMotion ? 0 : (openRisks.length + index) * 0.04,
                }}
              >
                <span className="oi-count" style={{ background: 'var(--tag-amber-bg)' }}>
                  C
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-primary)' }}>
                    {c.label}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-tertiary)' }}>
                    {c.owner ?? t('openIssues.noOwner', 'No owner')}
                  </div>
                </div>
                <Badge tone="amber">
                  {c.status?.replace('_', ' ') ??
                    t('openIssues.statusUnspecified', 'Unspecified')}
                </Badge>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
});
