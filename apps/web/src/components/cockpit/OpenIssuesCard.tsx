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

interface Props {
  risks: RiskItem[];
  compliance: ComplianceCheck[];
}

// Memoized — render is pure on risks+compliance arrays, both stable per
// snapshot fetch. Avoids re-render when sibling cards refetch.
export const OpenIssuesCard = memo(function OpenIssuesCard({ risks, compliance }: Props) {
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');
  const openRisks = risks.filter((r) => r.status === 'open' || r.status === 'in_progress');
  const openCompliance = compliance.filter(
    (c) => c.status === 'blocked' || c.status === 'in_progress' || c.status === 'not_started',
  );
  const total = openRisks.length + openCompliance.length;
  // Severity buckets are computed against the full risk list (not just open)
  // so the bar reflects the registry total rather than "what's left today".
  const buckets = [
    {
      label: 'Critical',
      labelText: t('openIssues.severityCritical', 'Critical'),
      count: risks.filter((risk) => risk.severity === 'critical').length,
      tone: 'tomato',
    },
    {
      label: 'High',
      labelText: t('openIssues.severityHigh', 'High'),
      count: risks.filter((risk) => risk.severity === 'high').length,
      tone: 'amber',
    },
    {
      label: 'Medium',
      labelText: t('openIssues.severityMedium', 'Medium'),
      count: risks.filter((risk) => risk.severity === 'medium').length,
      tone: 'blue',
    },
    {
      label: 'Low',
      labelText: t('openIssues.severityLow', 'Low'),
      count: risks.filter((risk) => risk.severity === 'low').length,
      tone: 'gray',
    },
  ] as const;

  return (
    <Card role="region" aria-label={t('openIssues.regionLabel', 'Open issues by severity')}>
      <SectionHeader
        title={t('openIssues.title', 'Open issues')}
        caption={
          total === 0
            ? t('openIssues.captionAllClear', 'All clear')
            : t('openIssues.captionItemsToAction', '{{count}} item{{plural}} to action', {
                count: total,
                plural: total === 1 ? '' : 's',
              })
        }
      />
      <div style={{ padding: '8px 18px 14px' }}>
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
        {total === 0 ? (
          <EmptyState
            title={t('openIssues.emptyTitle', 'No open issues')}
            message={t('openIssues.emptyMessage', 'Everything is green here.')}
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
                <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
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
                <Badge tone="amber">{c.status.replace('_', ' ')}</Badge>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
});
