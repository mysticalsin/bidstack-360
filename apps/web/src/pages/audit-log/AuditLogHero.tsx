/**
 * audit-log/AuditLogHero.tsx — hero banner + 5 metric cards for the AuditLog page.
 *
 * WHY a separate module: the hero section is ~100 lines of self-contained layout
 * and uses AnimatedMetric, Badge, Card, and Icon — none of which are needed by the
 * filter or table modules.
 */
import { type ReactNode } from 'react';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { relativeTime } from '@/lib/format';

import type { AuditStats } from './audit-log-helpers';
import { formatAbsolute } from './audit-log-helpers';

// ─── AuditHero ────────────────────────────────────────────────────────────────

export function AuditHero({
  stats,
  totalVisible,
  page,
  isLoading,
  lastRefreshedAt,
}: {
  stats: AuditStats;
  totalVisible: number;
  page: number;
  isLoading: boolean;
  lastRefreshedAt?: string;
}) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-6 shadow-[var(--shadow-soft)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-primary)]/40 to-transparent" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">Governance console</Badge>
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Read-only evidence trail
            </span>
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
              Audit Log
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              Review security, agent, workflow and CRM mutations with enough context to explain who
              changed what, when it happened and where to investigate next.
            </p>
          </div>
        </div>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="flex min-w-fit items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)]"
        >
          <span className="size-2 rounded-full bg-[var(--tag-jade-fg)] shadow-[0_0_0_4px_var(--tag-jade-bg)]" />
          {isLoading
            ? 'Refreshing evidence...'
            : `${totalVisible} visible on page ${page}${lastRefreshedAt ? ` · refreshed ${relativeTime(lastRefreshedAt)}` : ''}`}
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <AuditMetricCard
          icon="reports"
          label="Events loaded"
          value={<AnimatedMetric value={String(stats.total)} />}
          tone="blue"
          helper="Current server page"
        />
        <AuditMetricCard
          icon="shield"
          label="Security/API"
          value={<AnimatedMetric value={String(stats.security)} />}
          tone="purple"
          helper="Keys, MCP, auth, webhooks"
        />
        <AuditMetricCard
          icon="warning"
          label="Destructive"
          value={<AnimatedMetric value={String(stats.destructive)} />}
          tone="tomato"
          helper="Deletes, revokes, cancels"
        />
        <AuditMetricCard
          icon="building"
          label="CRM changes"
          value={<AnimatedMetric value={String(stats.crm)} />}
          tone="teal"
          helper="Revenue record edits"
        />
        <AuditMetricCard
          icon="clock"
          label="Latest event"
          value={stats.latest ? relativeTime(stats.latest) : 'None'}
          tone="jade"
          helper={stats.latest ? formatAbsolute(stats.latest) : 'No events in range'}
        />
      </div>
    </section>
  );
}

// ─── AuditMetricCard ──────────────────────────────────────────────────────────

function AuditMetricCard({
  icon,
  label,
  value,
  tone,
  helper,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  tone: BadgeTone;
  helper: string;
}) {
  return (
    <Card className="min-h-[128px] border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {label}
          </span>
          <span className="grid size-9 place-items-center rounded-2xl bg-[var(--surface-primary)] text-[var(--text-secondary)]">
            <Icon name={icon} className="size-4" />
          </span>
        </div>
        <div>
          <div className="text-2xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
            {value}
          </div>
          <Badge tone={tone} className="mt-2">
            {helper}
          </Badge>
        </div>
      </div>
    </Card>
  );
}
