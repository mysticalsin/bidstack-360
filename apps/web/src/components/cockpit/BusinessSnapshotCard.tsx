import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Card, SectionHeader } from '@/components/ui/Card';
import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import { relativeTime } from '@/lib/format';
import { springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot, CockpitKpi, SourceAttribution } from '@bidstack/shared';

import { SourceBadge, type CockpitSourceState } from './SourceBadge';
import { headquartersFor, labelForBand } from './_tokens';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

interface FieldSource {
  label: string;
  state: CockpitSourceState;
  hint: string;
}

interface SnapshotRow {
  label: string;
  value: string;
  source: FieldSource;
}

// Memoized — see TechStackCard for the rationale (stable cockpit prop;
// avoids re-render churn when sibling cards refetch).
export const BusinessSnapshotCard = memo(function BusinessSnapshotCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');
  const c = cockpit.company;
  const headquarters = headquartersFor(c.name);
  const sourceCount = c.sourceAttribution.length;
  const notVerified = t('businessSnapshot.value.notVerified', 'Not verified');
  const strategic = c.strategicIntel;
  const latestSource = latestAttribution(c.sourceAttribution);
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
  const rows: SnapshotRow[] = [
    {
      label: t('businessSnapshot.row.legalName', 'Legal name'),
      value: c.legalName ?? c.name,
      source: c.legalName
        ? attributionSource(latestSource, {
            fallbackLabel: t('businessSnapshot.source.companyRegistry', 'Registry'),
            missingHint: t(
              'businessSnapshot.source.noRegistry',
              'No registry attribution is attached.',
            ),
          })
        : {
            label: t('businessSnapshot.source.crm', 'CRM'),
            state: 'crm',
            hint: t(
              'businessSnapshot.source.crmNameHint',
              'Name is carried by the Polo PreSales account record.',
            ),
          },
    },
    {
      label: t('businessSnapshot.row.founded', 'Founded'),
      value: c.incorporationDate ? c.incorporationDate.slice(0, 4) : notVerified,
      source: c.incorporationDate
        ? attributionSource(latestSource, {
            fallbackLabel: t('businessSnapshot.source.companyRegistry', 'Registry'),
            missingHint: t(
              'businessSnapshot.source.noRegistry',
              'No registry attribution is attached.',
            ),
          })
        : missingSource(
            t(
              'businessSnapshot.source.missingFounded',
              'No incorporation date source is attached.',
            ),
          ),
    },
    {
      label: t('businessSnapshot.row.headquarters', 'Headquarters'),
      value: headquarters ?? notVerified,
      source: headquarters
        ? {
            label: t('businessSnapshot.source.derived', 'Derived'),
            state: 'crm',
            hint: t(
              'businessSnapshot.source.derivedHeadquarters',
              'Derived from Polo PreSales account geography rules.',
            ),
          }
        : missingSource(
            t('businessSnapshot.source.missingHeadquarters', 'No headquarters source is attached.'),
          ),
    },
    {
      label: t('businessSnapshot.row.annualRevenue', 'Annual revenue'),
      value: c.annualRevenueMicros
        ? `${formatUnspecifiedAmount(c.annualRevenueMicros / 1_000_000)} · ${UNSPECIFIED_CURRENCY_BASIS}`
        : notVerified,
      source: cockpitKpiSource(
        cockpit.kpis,
        'annualRevenueMicros',
        Boolean(c.annualRevenueMicros),
        {
          fallbackLabel: t('businessSnapshot.source.externalIntel', 'External'),
          missingHint: t(
            'businessSnapshot.source.missingRevenue',
            'No revenue source is attached.',
          ),
        },
      ),
    },
    {
      label: t('businessSnapshot.row.employees', 'Employees'),
      value: c.employeeCount ? c.employeeCount.toLocaleString() : notVerified,
      source: cockpitKpiSource(cockpit.kpis, 'employeeCount', Boolean(c.employeeCount), {
        fallbackLabel: t('businessSnapshot.source.externalIntel', 'External'),
        missingHint: t(
          'businessSnapshot.source.missingEmployees',
          'No headcount source is attached.',
        ),
      }),
    },
    {
      label: t('businessSnapshot.row.intentTopics', 'Intent topics'),
      value: intentSummary,
      source: strategicSource(
        strategic,
        t('businessSnapshot.source.missingIntent', 'No intent topic source is attached.'),
      ),
    },
    {
      label: t('businessSnapshot.row.hiringMovement', 'Hiring movement'),
      value: hiringSummary,
      source: strategicSource(
        strategic,
        t('businessSnapshot.source.missingHiring', 'No hiring signal source is attached.'),
      ),
    },
    {
      label: t('businessSnapshot.row.leadershipChanges', 'Leadership changes'),
      value: leadershipSummary,
      source: strategicSource(
        strategic,
        t('businessSnapshot.source.missingLeadership', 'No leadership signal source is attached.'),
      ),
    },
    {
      label: t('businessSnapshot.row.externalSync', 'External sync'),
      value: strategic?.lastSyncedAt
        ? `${strategic.freshness} - ${relativeTime(strategic.lastSyncedAt)}`
        : t('businessSnapshot.value.notSynced', 'Not synced'),
      source: strategicSource(
        strategic,
        t('businessSnapshot.source.notSynced', 'No external sync has run for this account.'),
      ),
    },
    {
      label: t('businessSnapshot.row.sourceReceipts', 'Source receipts'),
      value:
        sourceCount === 1
          ? t('businessSnapshot.value.sourceCount_one', '{{count}} source', { count: sourceCount })
          : t('businessSnapshot.value.sourceCount_other', '{{count}} sources', {
              count: sourceCount,
            }),
      source:
        sourceCount > 0
          ? {
              label: t('businessSnapshot.source.receipts', 'Receipts'),
              state: 'verified',
              hint: latestSource
                ? `${sourceCount} source receipt(s). Latest: ${latestSource.label} ${relativeTime(latestSource.fetchedAt)}.`
                : `${sourceCount} source receipt(s).`,
            }
          : missingSource(
              t('businessSnapshot.source.noReceipts', 'No source receipts are attached.'),
            ),
    },
    {
      label: t('businessSnapshot.row.lastRefreshed', 'Last refreshed'),
      value: relativeTime(c.updatedAt),
      source: {
        label: t('businessSnapshot.source.crmSnapshot', 'CRM'),
        state: 'crm',
        hint: t(
          'businessSnapshot.source.crmSnapshotHint',
          'Timestamp from the Polo PreSales account snapshot.',
        ),
      },
    },
    {
      label: t('businessSnapshot.row.confidence', 'Confidence'),
      value: `${Math.round(c.confidence * 100)}%`,
      source:
        sourceCount > 0
          ? {
              label: t('businessSnapshot.source.confidence', 'Confidence'),
              state: c.confidence >= 0.85 ? 'verified' : 'crm',
              hint: t(
                'businessSnapshot.source.confidenceHint',
                'Confidence is derived from attached source receipts.',
              ),
            }
          : {
              label: t('businessSnapshot.source.crm', 'CRM'),
              state: 'crm',
              hint: t(
                'businessSnapshot.source.crmConfidenceHint',
                'Confidence is derived from the current account record.',
              ),
            },
    },
  ];
  const notSynced = t('businessSnapshot.value.notSynced', 'Not synced');
  const recorded = rows.filter((row) => row.source.state !== 'missing' && row.value !== notVerified && row.value !== notSynced);
  const missing = rows.filter((row) => !recorded.includes(row));
  const recordedShare = rows.length === 0 ? 0 : Math.round((recorded.length / rows.length) * 100);

  return (
    <Card role="region" aria-label={t('businessSnapshot.region.ariaLabel', 'Business snapshot')}>
      <SectionHeader
        title={t('businessSnapshot.title', 'Business snapshot')}
        caption={t(
          'businessSnapshot.caption',
          'Signal band: {{band}}. Score {{score}}/100 is recorded-field coverage on this account, not a measured health score.',
          {
            band: labelForBand(cockpit.health.band),
            score: cockpit.health.score,
          },
        )}
      />
      <div style={{ padding: '14px 18px 18px' }}>
        <div className="mb-3">
          <div className="mb-1 flex items-baseline justify-between text-xs text-[var(--fg-secondary)]">
            <span>
              {t('businessSnapshot.recordedCount', '{{count}} recorded', { count: recorded.length })}
            </span>
            <span>
              {t('businessSnapshot.missingCount', '{{count}} not recorded', { count: missing.length })}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]" aria-hidden>
            <span
              className="block h-full rounded-full bg-[var(--brand-primary)]"
              style={{ width: `${recordedShare}%` }}
            />
          </div>
        </div>
        <SnapshotRows rows={recorded} reducedMotion={reducedMotion} />
        {missing.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-[var(--fg-secondary)]">
              {t('businessSnapshot.missingSummary', '{{count}} fields not recorded', {
                count: missing.length,
              })}
            </summary>
            <SnapshotRows rows={missing} reducedMotion={reducedMotion} />
          </details>
        ) : null}
      </div>
    </Card>
  );
});

function SnapshotRows({
  rows,
  reducedMotion,
}: {
  rows: SnapshotRow[];
  reducedMotion: boolean | null;
}) {
  return (
    <dl className="kvlist">
      {rows.map((row, index) => (
        <motion.div
          key={row.label}
          className="kv"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.032 }}
        >
          <dt>{row.label}</dt>
          <dd>
            <span className="kv-value">
              <AnimatedMetric value={row.value} />
            </span>
            <SourceBadge
              label={row.source.label}
              state={row.source.state}
              hint={row.source.hint}
              className="kv-source"
            />
          </dd>
        </motion.div>
      ))}
    </dl>
  );
}

function latestAttribution(sources: SourceAttribution[]): SourceAttribution | null {
  let latest: SourceAttribution | null = null;
  for (const source of sources) {
    if (!latest || source.fetchedAt > latest.fetchedAt) latest = source;
  }
  return latest;
}

function missingSource(hint: string): FieldSource {
  return { label: 'Missing', state: 'missing', hint };
}

function attributionSource(
  source: SourceAttribution | null,
  fallback: { fallbackLabel: string; missingHint: string },
): FieldSource {
  if (!source) return missingSource(fallback.missingHint);
  return {
    label: source.label || fallback.fallbackLabel,
    state: source.confidence >= 0.88 ? 'verified' : 'crm',
    hint: `${source.label || fallback.fallbackLabel} fetched ${relativeTime(source.fetchedAt)} at ${Math.round(source.confidence * 100)}% confidence.`,
  };
}

function cockpitKpiSource(
  kpis: CockpitKpi[],
  fieldKey: NonNullable<CockpitKpi['fieldKey']>,
  hasValue: boolean,
  fallback: { fallbackLabel: string; missingHint: string },
): FieldSource {
  if (!hasValue) return missingSource(fallback.missingHint);
  const kpi = kpis.find((item) => item.fieldKey === fieldKey);
  if (!kpi) return { label: fallback.fallbackLabel, state: 'crm', hint: fallback.fallbackLabel };
  return {
    label: kpi.overridden ? 'Manual' : (kpi.sourceLabel ?? fallback.fallbackLabel),
    state: kpi.sourceState ?? 'crm',
    hint: kpi.sourceHint ?? fallback.fallbackLabel,
  };
}

function strategicSource(
  strategic: AccountCockpitSnapshot['company']['strategicIntel'],
  missingHint: string,
): FieldSource {
  if (!strategic) return missingSource(missingHint);
  const label = strategic.provider || 'External';
  const lastSynced = strategic.lastSyncedAt
    ? ` Last synced ${relativeTime(strategic.lastSyncedAt)}.`
    : '';
  return {
    label,
    state:
      strategic.freshness === 'fresh'
        ? 'apollo_fresh'
        : strategic.freshness === 'stale'
          ? 'apollo_stale'
          : 'missing',
    hint: `${label} ${strategic.syncMode.replaceAll('_', ' ')}.${lastSynced}`,
  };
}
