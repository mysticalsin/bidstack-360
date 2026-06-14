/**
 * audit-log/AuditLogInsights.tsx — activity cadence chart, forensic watchlist,
 * and evidence quality card for the AuditLog insight strip.
 *
 * WHY a separate module: three co-located panels share the same data derivations
 * (buildActivityBuckets, buildStats, buildEvidenceHealth) and collectively form
 * a visual unit that sits between the hero and the filter bar.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AuditLogEntry } from '@bidstack/shared';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

import type { EvidenceHealth } from './audit-log-helpers';
import {
  actorLabel,
  buildActivityBuckets,
  buildEvidenceHealth,
  buildStats,
  humanizeKey,
  mostFrequent,
} from './audit-log-helpers';

// ─── AuditInsightStrip ────────────────────────────────────────────────────────

export function AuditInsightStrip({ rows }: { rows: AuditLogEntry[] }) {
  const { t } = useTranslation('crm');
  const buckets = useMemo(() => buildActivityBuckets(rows), [rows]);
  const stats = useMemo(() => buildStats(rows), [rows]);
  const evidenceHealth = useMemo(() => buildEvidenceHealth(rows), [rows]);
  const topActor = useMemo(() => mostFrequent(rows.map(actorLabel).filter(Boolean)), [rows]);
  const topTarget = useMemo(
    () => mostFrequent(rows.map((row) => row.targetType ?? 'system').filter(Boolean)),
    [rows],
  );
  const maxBucket = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const riskTotal = stats.security + stats.destructive;
  const riskRatio = rows.length === 0 ? 0 : Math.round((riskTotal / rows.length) * 100);

  return (
    <section className="grid gap-3 xl:grid-cols-[1.35fr_0.95fr_0.95fr]">
      <Card className="border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('auditLogInsights.activityCadenceTitle', 'Activity cadence')}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {t(
                'auditLogInsights.activityCadenceSubtitle',
                'Real event volume from the currently loaded evidence page.',
              )}
            </p>
          </div>
          <Badge tone={riskRatio >= 25 ? 'tomato' : riskRatio >= 10 ? 'amber' : 'jade'}>
            {t('auditLogInsights.attentionEventsBadge', '{{percent}}% attention events', {
              percent: riskRatio,
            })}
          </Badge>
        </div>
        <div
          className="mt-5 flex h-28 items-end gap-1.5"
          aria-label={t('auditLogInsights.eventVolumeChartLabel', 'Audit event volume chart')}
        >
          {buckets.map((bucket) => {
            const height =
              bucket.count === 0 ? 8 : Math.max(14, Math.round((bucket.count / maxBucket) * 100));
            return (
              <div key={bucket.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <div className="flex h-24 w-full items-end">
                  <div
                    className={cn(
                      'w-full rounded-t-lg transition-[height,background-color] duration-300',
                      bucket.destructive > 0
                        ? 'bg-[var(--tag-tomato-fg)]'
                        : bucket.security > 0
                          ? 'bg-[var(--tag-purple-fg)]'
                          : 'bg-[var(--accent-primary)]/70',
                    )}
                    style={{ height: `${height}%` }}
                    title={t('auditLogInsights.bucketTooltip', '{{label}}: {{count}} events', {
                      label: bucket.label,
                      count: bucket.count,
                    })}
                  />
                </div>
                <span className="max-w-full truncate text-[10px] font-medium text-[var(--text-muted)]">
                  {bucket.label}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('auditLogInsights.forensicWatchlistTitle', 'Forensic watchlist')}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {t('auditLogInsights.forensicWatchlistSubtitle', 'Fast triage from the loaded evidence set.')}
            </p>
          </div>
          <span className="grid size-9 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
            <Icon name="shield" className="size-4" />
          </span>
        </div>
        <div className="mt-4 grid gap-3">
          <AuditWatchItem
            label={t('auditLogInsights.topActorLabel', 'Top actor')}
            value={topActor?.value ?? t('auditLogInsights.noneValue', 'None')}
            detail={
              topActor
                ? t('auditLogInsights.eventsCount', '{{count}} events', { count: topActor.count })
                : t('auditLogInsights.noLoadedEvents', 'No loaded events')
            }
          />
          <AuditWatchItem
            label={t('auditLogInsights.hottestTargetLabel', 'Hottest target')}
            value={humanizeKey(topTarget?.value ?? t('auditLogInsights.noneValue', 'None'))}
            detail={
              topTarget
                ? t('auditLogInsights.eventsCount', '{{count}} events', { count: topTarget.count })
                : t('auditLogInsights.noLoadedEvents', 'No loaded events')
            }
          />
          <AuditWatchItem
            label={t('auditLogInsights.reviewQueueLabel', 'Review queue')}
            value={t('auditLogInsights.attentionEventsValue', '{{count}} attention events', {
              count: riskTotal,
            })}
            detail={t(
              'auditLogInsights.reviewQueueDetail',
              '{{destructive}} destructive, {{security}} security/API',
              { destructive: stats.destructive, security: stats.security },
            )}
          />
        </div>
      </Card>

      <EvidenceHealthCard health={evidenceHealth} />
    </section>
  );
}

// ─── EvidenceHealthCard ───────────────────────────────────────────────────────

function EvidenceHealthCard({ health }: { health: EvidenceHealth }) {
  const { t } = useTranslation('crm');
  return (
    <Card className="border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {t('auditLogInsights.evidenceQualityTitle', 'Evidence quality')}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {t('auditLogInsights.evidenceQualitySubtitle', 'Coverage signals that make audits defensible.')}
          </p>
        </div>
        <Badge tone={health.score >= 85 ? 'jade' : health.score >= 65 ? 'amber' : 'tomato'}>
          {t('auditLogInsights.scoreOutOf', '{{score}}/100', { score: health.score })}
        </Badge>
      </div>
      <div className="mt-4 grid gap-3">
        <EvidenceHealthRow
          label={t('auditLogInsights.structuredDiffsLabel', 'Structured diffs')}
          value={health.diffPct}
          detail={t('auditLogInsights.eventsRatioDetail', '{{count}}/{{total}} events', {
            count: health.withDiff,
            total: health.total,
          })}
        />
        <EvidenceHealthRow
          label={t('auditLogInsights.targetReferencesLabel', 'Target references')}
          value={health.targetPct}
          detail={t('auditLogInsights.linkedRatioDetail', '{{count}}/{{total}} linked', {
            count: health.withTarget,
            total: health.total,
          })}
        />
        <EvidenceHealthRow
          label={t('auditLogInsights.actorAttributionLabel', 'Actor attribution')}
          value={health.actorPct}
          detail={t('auditLogInsights.attributedRatioDetail', '{{count}}/{{total}} attributed', {
            count: health.withActor,
            total: health.total,
          })}
        />
      </div>
    </Card>
  );
}

// ─── EvidenceHealthRow ────────────────────────────────────────────────────────

function EvidenceHealthRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  const { t } = useTranslation('crm');
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          {label}
        </div>
        <div className="text-xs font-semibold text-[var(--text-secondary)]">{detail}</div>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-[var(--surface-secondary)]"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('auditLogInsights.healthRowProgressLabel', '{{label}}: {{value}}%', {
          label,
          value,
        })}
      >
        <div
          className="h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-500"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// ─── AuditWatchItem ───────────────────────────────────────────────────────────

function AuditWatchItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2.5">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
        {label}
      </div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
          {value}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">{detail}</span>
      </div>
    </div>
  );
}
