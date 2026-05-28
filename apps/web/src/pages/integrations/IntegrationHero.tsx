/**
 * integrations/IntegrationHero.tsx — hero banner and metric card strip for the
 * Integrations page.
 *
 * WHY a separate module: IntegrationHero is ~109 lines and IntegrationMetricCard
 * is ~36 lines. Together they are a self-contained "above the fold" section with
 * no query dependencies — they only receive props from IntegrationsPage.
 */
import { type ReactNode } from 'react';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { cn } from '@/lib/cn';

import type { IntegrationSummary } from './types';

// ─── Metric card ───────────────────────────────────────────────────────────────

function IntegrationMetricCard({
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

// ─── Hero ──────────────────────────────────────────────────────────────────────

export function IntegrationHero({
  activeTab,
  isLoading,
  summary,
  onCreateApiKey,
  onAddWebhook,
}: {
  activeTab: string;
  isLoading: boolean;
  summary: IntegrationSummary;
  onCreateApiKey: () => void;
  onAddWebhook: () => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-6 shadow-[var(--shadow-soft)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-primary)]/35 to-transparent" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">Integration fabric</Badge>
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              MCP, REST, webhooks, Dust
            </span>
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
              Integrations
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              Connect agents, APIs, ERP systems and event streams with clear setup paths, scoped
              credentials and live health checks that fit the rest of the CRM.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-end">
          <div
            role="status"
            aria-live="polite"
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 text-xs font-medium text-[var(--text-secondary)]"
          >
            <span
              className={cn(
                'size-2 rounded-full',
                summary.postureTone === 'jade'
                  ? 'bg-[var(--tag-jade-fg)] shadow-[0_0_0_4px_var(--tag-jade-bg)]'
                  : summary.postureTone === 'tomato'
                    ? 'bg-[var(--tag-tomato-fg)] shadow-[0_0_0_4px_var(--tag-tomato-bg)]'
                    : 'bg-[var(--tag-amber-fg)] shadow-[0_0_0_4px_var(--tag-amber-bg)]',
              )}
            />
            {isLoading ? 'Refreshing integration posture...' : summary.postureLabel}
          </div>
          <div className="flex flex-wrap gap-2">
            <LiquidGlassButton tone="secondary" size="sm" onClick={onCreateApiKey}>
              Create API key
            </LiquidGlassButton>
            <LiquidGlassButton tone="secondary" size="sm" onClick={onAddWebhook}>
              Add webhook
            </LiquidGlassButton>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <IntegrationMetricCard
          icon="git-branch"
          label="Ready paths"
          value={
            <AnimatedMetric
              value={`${summary.readyPaths} of ${summary.pathTotal}`}
              duration={0.7}
            />
          }
          tone={summary.readyPaths === summary.pathTotal ? 'jade' : 'amber'}
          helper={activeTab === 'overview' ? 'Current view' : 'Overview tab'}
        />
        <IntegrationMetricCard
          icon="sparkle"
          label="Dust agents"
          value={<AnimatedMetric value={String(summary.dustAgents)} />}
          tone={summary.dustAgents > 0 ? 'purple' : 'gray'}
          helper={summary.latestSyncLabel}
        />
        <IntegrationMetricCard
          icon="bell"
          label="Webhook events"
          value={<AnimatedMetric value={String(summary.webhookEvents)} />}
          tone={summary.attentionEvents > 0 ? 'tomato' : 'blue'}
          helper={
            summary.attentionEvents > 0
              ? `${summary.attentionEvents} need review`
              : 'No event errors loaded'
          }
        />
        <IntegrationMetricCard
          icon="shield"
          label="Active MCP tools"
          value={<AnimatedMetric value={String(summary.activeMcpTools)} />}
          tone="teal"
          helper="Dust-facing crm_* tools"
        />
        <IntegrationMetricCard
          icon="globe"
          label="Control plane"
          value={summary.postureLabel}
          tone={summary.postureTone}
          helper="Least-privilege setup"
        />
      </div>
    </section>
  );
}
