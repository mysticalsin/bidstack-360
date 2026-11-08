import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Card, SectionHeader } from '@/components/ui/Card';
import {
  unspecifiedMicrosLabel,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import { relativeTime } from '@/lib/format';
import { springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot, CockpitKpi, SourceAttribution } from '@bidstack/shared';

import { SourceBadge, type CockpitSourceState } from './SourceBadge';
import type { PublicCompanyFacts } from '@bidstack/shared';

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
  const facts: PublicCompanyFacts | null = c.publicFacts ?? null;
  const headquarters = facts?.headquarters ?? null;
  const sourceCount = c.sourceAttribution.length;
  const notVerified = t('businessSnapshot.value.notVerified', 'Not verified');
  const revenueLabel = recordedRevenueLabel(c);
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
    ...(facts?.description
      ? [
          {
            label: t('businessSnapshot.row.description', 'Public description'),
            value: facts.description,
            source: publicSource(c.sourceAttribution, t),
          },
        ]
      : []),
    {
      label: t('businessSnapshot.row.legalName', 'Legal name'),
      value: c.legalName ?? notVerified,
      source: c.legalName
        ? c.legalNameSource === 'account'
          ? {
              label: t('businessSnapshot.source.accountRecord', 'Account record'),
              state: 'crm' as const,
              hint: t(
                'businessSnapshot.source.accountLegalName',
                'Saved on the account record. This replaces the public official name.',
              ),
            }
          : fieldSource(c.sourceAttribution, latestSource, t, {
              fallbackLabel: t('businessSnapshot.source.companyRegistry', 'Registry'),
              missingHint: t(
                'businessSnapshot.source.noRegistry',
                'No registry attribution is attached.',
              ),
            })
        : missingSource(
            t(
              'businessSnapshot.source.missingLegalName',
              'No legal name is on file. The account name is not a legal name.',
            ),
          ),
    },
    {
      label: t('businessSnapshot.row.founded', 'Founded'),
      value: c.incorporationDate ?? notVerified,
      source: c.incorporationDate
        ? fieldSource(c.sourceAttribution, latestSource, t, {
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
        ? publicSource(c.sourceAttribution, t)
        : missingSource(
            t(
              'businessSnapshot.source.missingHeadquarters',
              'No headquarters is on the public profile.',
            ),
          ),
    },
    ...(facts?.chiefExecutive
      ? [
          {
            label: t('businessSnapshot.row.chiefExecutive', 'Chief executive'),
            value: facts.chiefExecutive,
            source: publicSource(c.sourceAttribution, t),
          },
        ]
      : []),
    ...(facts?.stockExchange
      ? [
          {
            label: t('businessSnapshot.row.stockExchange', 'Stock exchange'),
            value: facts.stockExchange,
            source: publicSource(c.sourceAttribution, t),
          },
        ]
      : []),
    {
      label: t('businessSnapshot.row.annualRevenue', 'Annual revenue'),
      value: facts?.revenueLabel ?? revenueLabel ?? notVerified,
      source: facts?.revenueLabel
        ? publicSource(c.sourceAttribution, t)
        : revenueLabel
          ? withCurrencyBasis(
              cockpitKpiSource(cockpit.kpis, 'annualRevenueMicros', true, {
                fallbackLabel: t('businessSnapshot.source.externalIntel', 'External'),
                missingHint: t(
                  'businessSnapshot.source.missingRevenue',
                  'No revenue source is attached.',
                ),
              }),
            )
          : cockpitKpiSource(cockpit.kpis, 'annualRevenueMicros', false, {
              fallbackLabel: t('businessSnapshot.source.externalIntel', 'External'),
              missingHint: t(
                'businessSnapshot.source.missingRevenue',
                'No revenue source is attached.',
              ),
            }),
    },
    {
      label: t('businessSnapshot.row.employees', 'Employees'),
      value: c.employeeCount ? c.employeeCount.toLocaleString() : notVerified,
      source: employeeSource(cockpit.kpis, c, t),
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
      value: (() => {
        const scored = c.sourceAttribution.filter(
          (source) => typeof source.confidence === 'number',
        );
        if (scored.length === 0) return t('businessSnapshot.value.notScored', 'Not scored');
        const average =
          scored.reduce((sum, source) => sum + (source.confidence ?? 0), 0) / scored.length;
        return `${Math.round(average * 100)}%`;
      })(),
      source: c.sourceAttribution.some((source) => typeof source.confidence === 'number')
        ? {
            label: t('businessSnapshot.source.confidence', 'Receipts'),
            state: 'crm',
            hint: t(
              'businessSnapshot.source.confidenceHint',
              'Average of attached source receipts. The stored company confidence is not shown.',
            ),
          }
        : {
            label: t('businessSnapshot.source.crm', 'CRM'),
            state: 'crm',
            hint: t(
              'businessSnapshot.source.crmConfidenceHint',
              sourceCount > 0
                ? 'A source receipt is attached, but it is not a scored source.'
                : 'No source receipts are attached, so this is not scored.',
            ),
          },
    },
  ];
  const notSynced = t('businessSnapshot.value.notSynced', 'Not synced');
  const recorded = rows.filter(
    (row) => row.source.state !== 'missing' && row.value !== notVerified && row.value !== notSynced,
  );
  const missing = rows.filter((row) => !recorded.includes(row));
  const recordedShare = rows.length === 0 ? 0 : Math.round((recorded.length / rows.length) * 100);

  return (
    <Card role="region" aria-label={t('businessSnapshot.region.ariaLabel', 'Business snapshot')}>
      <SectionHeader
        title={t('businessSnapshot.title', 'Business snapshot')}
        caption={t(
          'businessSnapshot.caption',
          '{{recorded}} of {{total}} fields on this card are filled. The bar is {{share}}% of those fields.',
          {
            recorded: recorded.length,
            total: rows.length,
            share: recordedShare,
          },
        )}
      />
      <div style={{ padding: '14px 18px 18px' }}>
        <div className="mb-3">
          <div className="mb-1 flex items-baseline justify-between text-xs text-[var(--fg-secondary)]">
            <span>
              {t('businessSnapshot.recordedCount', '{{count}} recorded', {
                count: recorded.length,
              })}
            </span>
            <span>
              {t('businessSnapshot.missingCount', '{{count}} not recorded', {
                count: missing.length,
              })}
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

function hasPublicRecord(sources: SourceAttribution[]): boolean {
  return sources.some((item) => item.source === 'wikidata' || item.source === 'wikipedia');
}

function fieldSource(
  sources: SourceAttribution[],
  latest: SourceAttribution | null,
  t: TFunction,
  fallback: { fallbackLabel: string; missingHint: string },
): FieldSource {
  return hasPublicRecord(sources) ? publicSource(sources, t) : attributionSource(latest, fallback);
}

function employeeSource(
  kpis: CockpitKpi[],
  company: AccountCockpitSnapshot['company'],
  t: TFunction,
): FieldSource {
  const overridden = kpis.some((item) => item.fieldKey === 'employeeCount' && item.overridden);
  if (!overridden && company.employeeCount && hasPublicRecord(company.sourceAttribution)) {
    return publicSource(company.sourceAttribution, t);
  }
  return cockpitKpiSource(kpis, 'employeeCount', Boolean(company.employeeCount), {
    fallbackLabel: t('businessSnapshot.source.externalIntel', 'External'),
    missingHint: t('businessSnapshot.source.missingEmployees', 'No headcount source is attached.'),
  });
}

function publicSource(sources: SourceAttribution[], t: TFunction): FieldSource {
  const source =
    sources.find((item) => item.source === 'wikidata') ??
    sources.find((item) => item.source === 'wikipedia') ??
    null;
  if (!source) {
    return {
      label: t('businessSnapshot.source.public', 'Public'),
      state: 'verified',
      hint: t('businessSnapshot.source.publicHint', 'Copied from the public company profile.'),
    };
  }
  return {
    label: source.source === 'wikipedia' ? 'Wikipedia' : 'Wikidata',
    state: 'verified',
    hint: source.label,
  };
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
    state: source.confidence != null && source.confidence >= 0.88 ? 'verified' : 'crm',
    hint:
      source.confidence == null
        ? `${source.label || fallback.fallbackLabel} fetched ${relativeTime(source.fetchedAt)}. Not scored.`
        : `${source.label || fallback.fallbackLabel} fetched ${relativeTime(source.fetchedAt)} at ${Math.round(source.confidence * 100)}% confidence.`,
  };
}

/** Stored revenue, compact while the unit count fits. A collapsed JSON number adds nothing. */
function recordedRevenueLabel(company: AccountCockpitSnapshot['company']): string | null {
  const text = company.annualRevenueMicrosText;
  if (text && /^\d+$/.test(text)) return unspecifiedMicrosLabel(text);
  const micros = company.annualRevenueMicros;
  if (typeof micros === 'number' && Number.isSafeInteger(micros) && micros > 0) {
    return unspecifiedMicrosLabel(micros);
  }
  return null;
}

function withCurrencyBasis(source: FieldSource): FieldSource {
  if (source.hint.includes(UNSPECIFIED_CURRENCY_BASIS)) return source;
  return { ...source, hint: `${UNSPECIFIED_CURRENCY_BASIS}. ${source.hint}` };
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
