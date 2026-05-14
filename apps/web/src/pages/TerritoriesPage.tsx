// Territories — mission control view.
//
// A world map heat-map shows opportunity density by country. Click a country
// to open its detail panel with top-level stats, territory owners, and a
// breakdown of opportunities in that region.

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { WorldMap } from '@/components/territories/WorldMap';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { formatMoney } from '@/lib/format';
import { staggerChild, staggerParent } from '@/lib/motion';

import {
  useTerritories,
  useLeadRoutingRules,
  useTerritoryAnalytics,
  type TerritoryAnalyticsItem,
} from '@/hooks/useTerritories';

export function TerritoriesPage() {
  const territories = useTerritories();
  const rules = useLeadRoutingRules();
  const analytics = useTerritoryAnalytics();
  const reducedMotion = useReducedMotion();
  const [selected, setSelected] = useState<TerritoryAnalyticsItem | null>(null);

  const tItems = territories.data?.items ?? [];
  const rItems = rules.data?.items ?? [];
  const aItems = analytics.data?.items ?? [];
  const totals = analytics.data?.totals;

  const isLoading = territories.isLoading || analytics.isLoading;
  const isError = territories.isError || analytics.isError;

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      {/* Header */}
      <motion.header
        variants={reducedMotion ? undefined : staggerChild}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            Territories
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Global opportunity footprint, territory coverage, and lead routing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totals ? (
            <div className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-xs font-semibold text-[var(--fg-secondary)]">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full bg-[var(--success)] ${
                  reducedMotion ? '' : 'animate-pulse'
                }`}
              />
              {totals.totalOpportunities} opps across {totals.totalCountries} countries
            </div>
          ) : null}
        </div>
      </motion.header>

      {/* KPI tiles */}
      {totals && (
        <motion.section
          variants={reducedMotion ? undefined : staggerChild}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <KpiTile
            label="Total Pipeline"
            value={formatMoney(totals.totalValueEur, 'EUR')}
            tone="blue"
          />
          <KpiTile label="Countries Active" value={String(totals.totalCountries)} tone="jade" />
          <KpiTile label="Opportunities" value={String(totals.totalOpportunities)} tone="amber" />
          <KpiTile label="Avg Probability" value={`${totals.avgProbability}%`} tone="purple" />
        </motion.section>
      )}

      {/* World Map */}
      <motion.div variants={reducedMotion ? undefined : staggerChild}>
        <Card className="overflow-hidden">
          <SectionHeader
            title="Global Opportunity Map"
            caption="Heat intensity = total pipeline value. Click a country for details."
          />
          {isError ? (
            <ErrorState
              title="Failed to load map data"
              message={analytics.error?.message ?? territories.error?.message}
              action={
                <Button
                  onClick={() => {
                    analytics.refetch();
                    territories.refetch();
                  }}
                >
                  Retry
                </Button>
              }
            />
          ) : isLoading ? (
            <div className="h-[420px] flex items-center justify-center">
              <TableSkeleton rows={6} columns={4} headless />
            </div>
          ) : aItems.length === 0 ? (
            <div className="h-[420px] flex items-center justify-center">
              <EmptyState
                title="No geographic data"
                message="Opportunities need a country or territory assignment to appear on the map."
              />
            </div>
          ) : (
            <div className="h-[480px] w-full">
              <WorldMap data={aItems} onCountryClick={setSelected} className="h-full w-full" />
            </div>
          )}
        </Card>
      </motion.div>

      {/* Bottom row: Country detail + Territories list + Routing rules */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        {/* Selected country detail */}
        <Card className={selected ? '' : 'opacity-60'}>
          <SectionHeader
            title={selected ? `${selected.countryCode} Detail` : 'Country Detail'}
            caption={selected ? undefined : 'Click a country on the map'}
          />
          {selected ? (
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    Opportunities
                  </div>
                  <div className="mt-1 text-lg font-bold text-[var(--fg-primary)] tabular-nums">
                    {selected.opportunityCount}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    Pipeline
                  </div>
                  <div className="mt-1 text-lg font-bold text-[var(--fg-primary)] tabular-nums">
                    {formatMoney(selected.totalValueEur, 'EUR')}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-[var(--fg-secondary)] mb-1">
                  Territories
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.territories.length > 0 ? (
                    selected.territories.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-secondary)]"
                      >
                        {t}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--fg-tertiary)]">—</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-[var(--fg-secondary)] mb-1">Owners</div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.ownerNames.length > 0 ? (
                    selected.ownerNames.map((o) => (
                      <span
                        key={o}
                        className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-secondary)]"
                      >
                        {o}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--fg-tertiary)]">—</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-[var(--fg-tertiary)]">
              Select a country on the map to see details
            </div>
          )}
        </Card>

        {/* Territories list */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-[var(--fg-primary)]">Territories</h2>
          {territories.isError ? (
            <ErrorState
              title="Failed to load"
              message={territories.error?.message}
              action={<Button onClick={() => territories.refetch()}>Retry</Button>}
            />
          ) : territories.isLoading ? (
            <TableSkeleton rows={4} />
          ) : tItems.length === 0 ? (
            <EmptyState title="No territories" />
          ) : (
            <div className="space-y-2">
              {tItems.map((t) => (
                <Card key={t.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-[var(--fg-primary)]">{t.name}</div>
                      <div className="text-xs text-[var(--fg-secondary)]">
                        {t.region ?? 'No region'} · {t.countryCodes.join(', ') || 'Global'}
                      </div>
                    </div>
                    <div className="text-xs text-[var(--fg-tertiary)]">{t.ownerName ?? '—'}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Lead Routing Rules */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-[var(--fg-primary)]">
            Lead Routing Rules
          </h2>
          {rules.isError ? (
            <ErrorState
              title="Failed to load"
              message={rules.error?.message}
              action={<Button onClick={() => rules.refetch()}>Retry</Button>}
            />
          ) : rules.isLoading ? (
            <TableSkeleton rows={4} />
          ) : rItems.length === 0 ? (
            <EmptyState title="No routing rules" />
          ) : (
            <div className="space-y-2">
              {rItems.map((r) => (
                <Card key={r.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-[var(--fg-primary)]">{r.name}</div>
                      <div className="text-xs text-[var(--fg-secondary)]">
                        Priority {r.priority} ·{' '}
                        {r.assignToUserId
                          ? 'Assign to user'
                          : r.assignToTerritoryId
                            ? 'Assign to territory'
                            : 'Round robin'}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'blue' | 'jade' | 'amber' | 'purple';
}) {
  const dotColor =
    tone === 'blue'
      ? '#2c4bff'
      : tone === 'jade'
        ? '#059669'
        : tone === 'amber'
          ? '#d97706'
          : '#7c3aed';

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} />
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          {label}
        </div>
      </div>
      <div className="mt-1 text-lg font-bold text-[var(--fg-primary)] tabular-nums">{value}</div>
    </div>
  );
}
