import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { daysUntilDueUtc } from '@/components/ui/DueDateChip';
import { EmptyState } from '@/components/ui/StateMessages';
import { springSoft } from '@/lib/motion';

import type { ComplianceCheck, RiskItem } from '@bidstack/shared';

import { severityBg, severityTone } from './_tokens';

// dueDate is a UTC calendar day, the same clock as the bid due chip. Formatting
// in the viewer's zone would print the previous local day for a date-only
// string, so the label and the late count would name different days.
function formatUtcDueDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const locale =
    typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function OpenIssueMeta({ owner, dueDate }: { owner: string | null; dueDate: string | null }) {
  const { t } = useTranslation('crm');
  const days = dueDate ? daysUntilDueUtc(dueDate) : null;
  const late = days !== null && days < 0;
  return (
    <div style={{ fontSize: 11.5, color: 'var(--fg-tertiary)' }}>
      {owner ?? t('openIssues.unassigned', 'Unassigned')}
      {dueDate
        ? t('openIssues.dueSuffix', ' - due {{dueDate}}', { dueDate: formatUtcDueDay(dueDate) })
        : ''}
      {late ? (
        <span className="ml-2 font-semibold text-[var(--danger)]">
          {t('openIssues.overdue', 'Overdue: {{count}}d late', { count: Math.abs(days) })}
        </span>
      ) : null}
    </div>
  );
}

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
  const severityLabel: Record<RiskItem['severity'], string> = {
    critical: buckets[0].labelText,
    high: buckets[1].labelText,
    medium: buckets[2].labelText,
    low: buckets[3].labelText,
  };

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
            message={t('openIssues.emptyMessage', 'No risks or compliance checks are recorded for this account yet.')}
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
                  {severityLabel[r.severity]}
                </span>
                <div className="oi-body">
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-primary)' }}>
                    {r.title}
                  </div>
                  <OpenIssueMeta owner={r.owner} dueDate={r.dueDate} />
                </div>
                <Badge tone={severityTone(r.severity)}>{r.status.replace('_', ' ')}</Badge>
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
                  {t('openIssues.kindCompliance', 'Compliance')}
                </span>
                <div className="oi-body">
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
