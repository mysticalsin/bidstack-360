/**
 * audit-log/AuditLogInsights.tsx — activity cadence chart, forensic watchlist,
 * and evidence quality card for the AuditLog insight strip.
 *
 * WHY a separate module: three co-located panels share the same data derivations
 * (buildActivityBuckets, buildStats, buildEvidenceHealth) and collectively form
 * a visual unit that sits between the hero and the filter bar.
 */
import { useMemo } from 'react';

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
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Activity cadence</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Real event volume from the currently loaded evidence page.
            </p>
          </div>
          <Badge tone={riskRatio >= 25 ? 'tomato' : riskRatio >= 10 ? 'amber' : 'jade'}>
            {riskRatio}% attention events
          </Badge>
        </div>
        <div className="mt-5 flex h-28 items-end gap-1.5" aria-label="Audit event volume chart">
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
                    title={`${bucket.label}: ${bucket.count} events`}
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
              Forensic watchlist
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Fast triage from the loaded evidence set.
            </p>
          </div>
          <span className="grid size-9 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
            <Icon name="shield" className="size-4" />
          </span>
        </div>
        <dl className="mt-4 grid gap-3">
          <AuditWatchItem
            label="Top actor"
            value={topActor?.value ?? 'None'}
            detail={topActor ? `${topActor.count} events` : 'No loaded events'}
          />
          <AuditWatchItem
            label="Hottest target"
            value={humanizeKey(topTarget?.value ?? 'None')}
            detail={topTarget ? `${topTarget.count} events` : 'No loaded events'}
          />
          <AuditWatchItem
            label="Review queue"
            value={`${riskTotal} attention events`}
            detail={`${stats.destructive} destructive, ${stats.security} security/API`}
          />
        </dl>
      </Card>

      <EvidenceHealthCard health={evidenceHealth} />
    </section>
  );
}

// ─── EvidenceHealthCard ───────────────────────────────────────────────────────

function EvidenceHealthCard({ health }: { health: EvidenceHealth }) {
  return (
    <Card className="border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Evidence quality</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Coverage signals that make audits defensible.
          </p>
        </div>
        <Badge tone={health.score >= 85 ? 'jade' : health.score >= 65 ? 'amber' : 'tomato'}>
          {health.score}/100
        </Badge>
      </div>
      <dl className="mt-4 grid gap-3">
        <EvidenceHealthRow
          label="Structured diffs"
          value={health.diffPct}
          detail={`${health.withDiff}/${health.total} events`}
        />
        <EvidenceHealthRow
          label="Target references"
          value={health.targetPct}
          detail={`${health.withTarget}/${health.total} linked`}
        />
        <EvidenceHealthRow
          label="Actor attribution"
          value={health.actorPct}
          detail={`${health.withActor}/${health.total} attributed`}
        />
      </dl>
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
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {label}
        </dt>
        <dd className="text-xs font-semibold text-[var(--text-secondary)]">{detail}</dd>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-[var(--surface-secondary)]"
        aria-label={`${label}: ${value}%`}
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
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 flex flex-wrap items-end justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
          {value}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">{detail}</span>
      </dd>
    </div>
  );
}
