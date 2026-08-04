/**
 * /dev/table-kit — the grafted table-kit rendered against fixture data.
 *
 * WHY this page exists: the graft lands 18 files that no product surface
 * consumes until Phase 3. Without a specimen page the only proof the port
 * worked is "typecheck passed", which says nothing about whether a status dot
 * is legible on dark or whether a KPI strip still reads as one instrument.
 * This is the surface a reviewer actually looks at.
 *
 * Dev-only: mounted from routes/DevRoutes.tsx behind import.meta.env.DEV, so
 * the module is dead code (and un-chunked) in a production build.
 *
 * Both themes at once: ThemePanel renders the same specimen twice inside
 * wrappers carrying data-theme="light" / data-theme="dark". BidStack declares
 * its dark tokens on an unqualified `[data-theme='dark']` selector
 * (index.css:193) and maps the `dark:` variant to `[data-theme="dark"] *`
 * (index.css:27), so both halves of the theme contract re-scope to a subtree.
 * No iframe, no second render root.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardPanelEmpty,
  CardTitle,
} from '@/components/table-kit/card';
import {
  ChartCard,
  DashboardGrid,
  DashboardRow,
  DashboardSection,
  DashboardSkeleton,
  KpiCard,
  StatGroup,
} from '@/components/table-kit/dashboard';
import { EmptyCellValue } from '@/components/table-kit/empty-cell';
import { Skeleton } from '@/components/table-kit/skeleton';
import { Spinner } from '@/components/table-kit/spinner';
import { StatCard, StatDeltaText } from '@/components/table-kit/stat-card';
import { IndicatorDot, StatusIndicator } from '@/components/table-kit/status-indicator';
import { Icon, type IconName, iconMotionFor } from '@/components/ui/Icon';

import {
  CardTableSpecimen,
  DataTableSpecimen,
  DropdownSpecimen,
  EmptySpecimen,
  PaginationSpecimen,
  SimpleTableSpecimen,
  TablePrimitivesSpecimen,
} from './TableKitTables';
import { EUR, PROPOSALS, TONE_LABEL, TONES } from './table-kit-fixtures';

// One name per motion verb in the re-keyed MOTION_BY_ICON, plus one unmapped
// name so the "pop" fallback is visible too.
const MOTION_SAMPLES: IconName[] = [
  'arrow', 'chevron-right', 'caret', 'caretup', 'download', 'upload', 'link',
  'settings', 'refresh', 'globe', 'plus', 'close', 'trash', 'search', 'wand',
  'warning', 'info', 'shield', 'sparkle', 'zap', 'moon', 'bell', 'loader', 'briefcase',
];

export default function TableKitPlayground() {
  const { t } = useTranslation('common');

  return (
    <div className="flex flex-col gap-10 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-semibold text-[var(--fg-primary)]">
          {t('devPlayground.title', 'Table kit — specimen sheet')}
        </h1>
        <p className="max-w-2xl text-sm text-[var(--fg-secondary)]">
          {t(
            'devPlayground.subtitle',
            'Every grafted table-kit component against bid-desk fixture data. Dev route — never linked from the product shell.',
          )}
        </p>
      </header>

      <Section
        title={t('devPlayground.sectionThemes', 'Both themes, side by side')}
        hint={t(
          'devPlayground.hintThemes',
          'Geometry is identical in both panels. Only colour changes — that is the whole law.',
        )}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ThemePanel theme="light" label={t('devPlayground.themeLight', 'Light')} />
          <ThemePanel theme="dark" label={t('devPlayground.themeDark', 'Dark')} />
        </div>
      </Section>

      <Section title={t('devPlayground.sectionData', 'Data table')}>
        <DataTableSpecimen />
      </Section>

      <Section
        title={t('devPlayground.sectionRows', 'Table primitives')}
        hint={t(
          'devPlayground.hintRows',
          'Hover a row: a 2px bar pins to the edge and the first cell eases out 4px. Dotted values carry a receipt.',
        )}
      >
        <TablePrimitivesSpecimen />
        <SimpleTableSpecimen />
        <div className="rounded-lg border border-border-subtle bg-surface-card py-4">
          <CardTableSpecimen />
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-card py-4">
          <CardTableSpecimen empty />
        </div>
        <PaginationSpecimen />
      </Section>

      <Section title={t('devPlayground.sectionEmpty', 'Empty state and menu')}>
        <EmptySpecimen />
        <DropdownSpecimen />
      </Section>

      <Section title={t('devPlayground.sectionStatus', 'Status indicators')}>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          {TONES.map((tone) => (
            <StatusIndicator key={tone} tone={tone} label={TONE_LABEL[tone]} size="sm" />
          ))}
          <StatusIndicator tone="info" label="Scoring…" busy size="sm" />
          <StatusIndicator tone="warning" label="Awaiting sign-off" pulse bloom="high" size="sm" />
          <span className="inline-flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
            <IndicatorDot tone="success" bloom="aura" aria-hidden="true" />
            {t('devPlayground.bloomAura', 'Dot only, aura bloom')}
          </span>
        </div>
      </Section>

      <Section title={t('devPlayground.sectionStats', 'KPI strip')}>
        <StatGroup>
          <StatCard
            label="Pipeline value"
            value={EUR.format(5_740_000)}
            delta={{ value: '+12.4%', label: 'vs Q2' }}
          />
          <StatCard label="Win rate" value="38%" delta={{ value: '-2.1 pts', label: 'vs Q2' }} />
          <StatCard
            label="Bids in flight"
            value="17"
            delta={{ value: '0', direction: 'neutral', label: 'flat' }}
          />
          <StatCard
            label="Mandatory gaps"
            value="3"
            description="Open compliance rows blocking approval."
          />
        </StatGroup>
        <p className="text-xs text-[var(--fg-tertiary)]">
          {t('devPlayground.deltaInline', 'Delta, standalone:')}{' '}
          <StatDeltaText delta={{ value: '+4.8%', label: 'renewals' }} />
        </p>
      </Section>

      <Section title={t('devPlayground.sectionDashboard', 'Dashboard layout')}>
        <DashboardSection
          title={t('devPlayground.dashboardTitle', 'Q3 bid desk')}
          description={t(
            'devPlayground.dashboardCaption',
            'Grafted layout primitives, no chart library.',
          )}
          action={<StatusIndicator tone="info" label="Live" size="sm" />}
        >
          <DashboardRow>
            <ChartCard
              title="Submissions by week"
              description="Rendered as a bar proxy — the chart tier is out of scope this round."
              footer="Source: proposals.submittedAt"
            >
              <BarProxy />
            </ChartCard>
            <KpiCard title="Coverage">
              <div className="flex flex-col gap-3">
                {PROPOSALS.slice(0, 3).map((row) => (
                  <StatusIndicator key={row.id} tone={row.tone} label={row.client} size="sm" />
                ))}
              </div>
            </KpiCard>
          </DashboardRow>
          <DashboardGrid columns={3}>
            <CardContent>
              <CardHeader>
                <CardTitle>Mandatory requirements</CardTitle>
                <CardDescription>Answered vs. outstanding across open lots.</CardDescription>
                <CardAction>
                  <Icon name="sliders" size={16} />
                </CardAction>
              </CardHeader>
              <span className="text-3xl font-medium tabular-nums">128 / 141</span>
              <CardFooter>
                <StatusIndicator tone="warning" label="13 unanswered" size="sm" />
              </CardFooter>
            </CardContent>
            <CardPanel>
              <div className="border-b border-border-subtle p-4">
                <CardTitle>Recent activity</CardTitle>
              </div>
              <CardPanelEmpty>
                {t('devPlayground.emptyPanel', 'Nothing yet in this window.')}
              </CardPanelEmpty>
            </CardPanel>
            <Card>
              <CardHeader>
                <CardTitle>Bare card slot</CardTitle>
                <CardDescription>No surface of its own — composes into a parent.</CardDescription>
              </CardHeader>
              <div className="flex items-center gap-3">
                <Spinner className="size-4" />
                <span className="text-xs text-[var(--fg-secondary)]">
                  {t('devPlayground.loading', 'Recomputing scores…')}
                </span>
              </div>
            </Card>
          </DashboardGrid>
        </DashboardSection>
      </Section>

      <Section title={t('devPlayground.sectionSkeleton', 'Loading tier')}>
        <DashboardSkeleton stats={4} />
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      </Section>

      <Section
        title={t('devPlayground.sectionIcons', 'Icon micro-motion')}
        hint={t(
          'devPlayground.hintIcons',
          'Hover a tile. The verb is derived from the icon name inside Icon.tsx — no call site passes it.',
        )}
      >
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {MOTION_SAMPLES.map((name) => (
            <button
              key={name}
              type="button"
              className="flex min-h-11 flex-col items-center gap-1 rounded-md border border-border-subtle bg-surface-card px-3 py-2 text-[var(--fg-secondary)] transition-colors hover:border-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              <Icon name={name} size={20} />
              <span className="text-[10px] tabular-nums">{iconMotionFor(name)}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ─── Local specimens ──────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium text-sm tracking-tight text-[var(--fg-primary)]">{title}</h2>
      {hint ? <p className="text-xs text-[var(--fg-tertiary)]">{hint}</p> : null}
      {children}
    </section>
  );
}

/** One theme's worth of the kit, scoped by data-theme so both render at once. */
function ThemePanel({ theme, label }: { theme: 'light' | 'dark'; label: string }) {
  return (
    <div
      data-theme={theme}
      className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-page p-4"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
        {label}
      </span>
      <StatGroup>
        <StatCard label="Pipeline" value={EUR.format(5_740_000)} delta={{ value: '+12.4%' }} />
        <StatCard label="Win rate" value="38%" delta={{ value: '-2.1 pts' }} />
      </StatGroup>
      <CardContent>
        <CardHeader>
          <CardTitle>Enedis — Lot 1</CardTitle>
          <CardDescription>Field mobility, tranche ferme.</CardDescription>
        </CardHeader>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {TONES.map((tone) => (
            <StatusIndicator key={tone} tone={tone} label={TONE_LABEL[tone]} size="sm" />
          ))}
        </div>
        <CardFooter>
          <span className="text-xs tabular-nums text-[var(--fg-secondary)]">
            {EUR.format(860_000)}
          </span>
          <EmptyCellValue />
        </CardFooter>
      </CardContent>
      <SimpleTableSpecimen />
    </div>
  );
}

/** Static bar proxy — the chart tier is not part of this graft. */
function BarProxy() {
  const bars = [42, 61, 35, 78, 54, 88, 47];
  return (
    <div className="flex h-40 items-end gap-2 px-5 md:px-6">
      {bars.map((height, i) => (
        <div
          // Index key: fixed-length fixture, never reordered.
          key={i}
          className="flex-1 rounded-sm bg-brand-tint"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}
