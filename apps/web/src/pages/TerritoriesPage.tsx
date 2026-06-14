// Territories — mission control view with full CRUD.
//
// A world map heat-map shows opportunity density by country. Click a country
// to open its detail panel with top-level stats, territory owners, and a
// breakdown of opportunities in that region.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';

import { WorldMap } from '@/components/territories/WorldMap';
import { TerritorySegmentBreakdown } from '@/components/territories/TerritorySegmentBreakdown';
import { TerritoryDialog } from '@/components/territories/TerritoryDialog';
import { RoutingRuleDialog } from '@/components/territories/RoutingRuleDialog';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { Icon } from '@/components/ui/Icon';
import { confirm } from '@/components/ui/ConfirmDialog';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { staggerChild, staggerParent } from '@/lib/motion';

import {
  useTerritories,
  useLeadRoutingRules,
  useTerritoryAnalytics,
  useCreateTerritory,
  useUpdateTerritory,
  useDeleteTerritory,
  useCreateLeadRoutingRule,
  useUpdateLeadRoutingRule,
  useDeleteLeadRoutingRule,
  useTerritorySegments,
  type TerritoryAnalyticsItem,
} from '@/hooks/useTerritories';

import type { Territory, LeadRoutingRule } from '@bidstack/shared';

import {
  CountryDetailPanel,
  KpiTile,
  RoutingRuleListPanel,
  TerritoryListPanel,
} from './territoriesPage/TerritoryPanels';

export function TerritoriesPage() {
  const { t } = useTranslation('crm');
  const { formatMoneyMicros } = useFormatMoney();
  const territories = useTerritories();
  const rules = useLeadRoutingRules();
  const analytics = useTerritoryAnalytics();
  const reducedMotion = useReducedMotion();
  const [selected, setSelected] = useState<TerritoryAnalyticsItem | null>(null);
  // Which dimension the main panel breaks opportunities down by. 'region' keeps
  // the world map; 'industry'/'account' swap in the segment breakdown.
  const [view, setView] = useState<'region' | 'industry' | 'account'>('region');
  const segments = useTerritorySegments(view === 'region' ? 'country' : view);

  // Dialog state
  const [territoryDialogOpen, setTerritoryDialogOpen] = useState(false);
  const [editingTerritory, setEditingTerritory] = useState<Territory | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<LeadRoutingRule | null>(null);

  // Mutations
  const createTerritory = useCreateTerritory();
  const updateTerritory = useUpdateTerritory();
  const deleteTerritory = useDeleteTerritory();
  const createRule = useCreateLeadRoutingRule();
  const updateRule = useUpdateLeadRoutingRule();
  const deleteRule = useDeleteLeadRoutingRule();

  const tItems = territories.data?.items ?? [];
  const rItems = rules.data?.items ?? [];
  const aItems = analytics.data?.items ?? [];
  const totals = analytics.data?.totals;

  const isLoading = territories.isLoading || analytics.isLoading;
  const isError = territories.isError || analytics.isError;

  const handleDeleteTerritory = async (territory: Territory) => {
    if (
      await confirm({
        title: t('territories.deleteTerritoryConfirmTitle', 'Delete "{{name}}"?', {
          name: territory.name,
        }),
        description: t(
          'territories.deleteTerritoryConfirmDescription',
          'This territory will be deactivated.',
        ),
        destructive: true,
      })
    ) {
      deleteTerritory.mutate(territory.id);
    }
  };

  const handleDeleteRule = async (r: LeadRoutingRule) => {
    if (
      await confirm({
        title: t('territories.deleteRuleConfirmTitle', 'Delete "{{name}}"?', { name: r.name }),
        description: t(
          'territories.deleteRuleConfirmDescription',
          'This routing rule will be deactivated.',
        ),
        destructive: true,
      })
    ) {
      deleteRule.mutate(r.id);
    }
  };

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
            {t('territories.pageTitle', 'Territories')}
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {t(
              'territories.pageSubtitle',
              'Global opportunity footprint, territory coverage, and lead routing.',
            )}
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
              {t(
                'territories.totalsBadge',
                '{{opportunities}} opps across {{countries}} countries',
                {
                  opportunities: totals.totalOpportunities,
                  countries: totals.totalCountries,
                },
              )}
            </div>
          ) : null}
          <Button
            size="sm"
            onClick={() => {
              setEditingRule(null);
              setRuleDialogOpen(true);
            }}
          >
            <Icon name="git-branch" size={14} /> {t('territories.newRuleButton', 'New rule')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingTerritory(null);
              setTerritoryDialogOpen(true);
            }}
          >
            <Icon name="plus" size={14} /> {t('territories.newTerritoryButton', 'New territory')}
          </Button>
        </div>
      </motion.header>

      {/* Dialogs */}
      <TerritoryDialog
        territory={editingTerritory}
        open={territoryDialogOpen}
        onClose={() => setTerritoryDialogOpen(false)}
        onSubmit={(body) => {
          if (editingTerritory) {
            updateTerritory.mutate(
              { id: editingTerritory.id, ...body },
              { onSuccess: () => setTerritoryDialogOpen(false) },
            );
          } else {
            createTerritory.mutate(body as Territory, {
              onSuccess: () => setTerritoryDialogOpen(false),
            });
          }
        }}
        isPending={createTerritory.isPending || updateTerritory.isPending}
      />
      <RoutingRuleDialog
        rule={editingRule}
        open={ruleDialogOpen}
        onClose={() => setRuleDialogOpen(false)}
        onSubmit={(body) => {
          if (editingRule) {
            updateRule.mutate(
              { id: editingRule.id, ...body },
              { onSuccess: () => setRuleDialogOpen(false) },
            );
          } else {
            createRule.mutate(body as LeadRoutingRule, {
              onSuccess: () => setRuleDialogOpen(false),
            });
          }
        }}
        isPending={createRule.isPending || updateRule.isPending}
      />

      {/* KPI tiles */}
      {totals && (
        <motion.section
          variants={reducedMotion ? undefined : staggerChild}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <KpiTile
            label={t('territories.kpiTotalPipeline', 'Total Pipeline')}
            value={formatMoneyMicros(totals.totalValueMicros, 'EUR')}
            tone="blue"
          />
          <KpiTile
            label={t('territories.kpiCountriesActive', 'Countries Active')}
            value={String(totals.totalCountries)}
            tone="jade"
          />
          <KpiTile
            label={t('territories.kpiOpportunities', 'Opportunities')}
            value={String(totals.totalOpportunities)}
            tone="amber"
          />
          <KpiTile
            label={t('territories.kpiAvgProbability', 'Avg Probability')}
            value={`${totals.avgProbability}%`}
            tone="purple"
          />
        </motion.section>
      )}

      {/* Opportunity breakdown — region map, or industry/account segments */}
      <motion.div variants={reducedMotion ? undefined : staggerChild}>
        <Card className="overflow-hidden">
          <SectionHeader
            title={
              view === 'region'
                ? t('territories.sectionTitleRegion', 'Global Opportunity Map')
                : view === 'industry'
                  ? t('territories.sectionTitleIndustry', 'Opportunities by Industry')
                  : t('territories.sectionTitleAccount', 'Opportunities by Account')
            }
            caption={
              view === 'region'
                ? t(
                    'territories.sectionCaptionRegion',
                    'Heat intensity = total pipeline value. Click a country for details.',
                  )
                : t(
                    'territories.sectionCaptionSegment',
                    'Ranked by total pipeline value across all opportunities.',
                  )
            }
            action={
              <div
                role="tablist"
                aria-label={t('territories.breakdownTablistLabel', 'Breakdown dimension')}
                className="inline-flex rounded-lg border border-[var(--border-default)] p-0.5"
              >
                {(
                  [
                    ['region', t('territories.tabRegion', 'Region')],
                    ['industry', t('territories.tabIndustry', 'Industry')],
                    ['account', t('territories.tabAccount', 'Account')],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={view === key}
                    onClick={() => setView(key)}
                    className={`min-h-9 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] ${
                      view === key
                        ? 'bg-[var(--brand-primary)] text-white'
                        : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          />
          {view === 'region' ? (
            isError ? (
              <ErrorState
                title={t('territories.mapErrorTitle', 'Failed to load map data')}
                message={analytics.error?.message ?? territories.error?.message}
                action={
                  <Button
                    onClick={() => {
                      analytics.refetch();
                      territories.refetch();
                    }}
                  >
                    {t('territories.retryButton', 'Retry')}
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
                  title={t('territories.mapEmptyTitle', 'No geographic data')}
                  message={t(
                    'territories.mapEmptyMessage',
                    'Opportunities need a country or territory assignment to appear on the map.',
                  )}
                />
              </div>
            ) : (
              <div className="h-[480px] w-full">
                <WorldMap
                  data={aItems}
                  onCountryClick={(item) =>
                    setSelected((prev) => (prev?.countryCode === item.countryCode ? null : item))
                  }
                  selectedCountryCode={selected?.countryCode}
                  className="h-full w-full"
                />
              </div>
            )
          ) : (
            <TerritorySegmentBreakdown
              dimension={view}
              segments={segments.data?.items ?? []}
              isLoading={segments.isLoading}
              isError={segments.isError}
              errorMessage={segments.error?.message}
              onRetry={() => void segments.refetch()}
              formatMoneyMicros={formatMoneyMicros}
            />
          )}
        </Card>
      </motion.div>

      {/* Bottom row: Country detail + Territories list + Routing rules */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        <CountryDetailPanel
          selected={selected}
          formatMoneyMicros={formatMoneyMicros}
          globalTotals={totals}
          onClear={() => setSelected(null)}
        />
        <TerritoryListPanel
          items={tItems}
          isLoading={territories.isLoading}
          isError={territories.isError}
          errorMessage={territories.error?.message}
          onRetry={() => territories.refetch()}
          onEdit={(t) => {
            setEditingTerritory(t);
            setTerritoryDialogOpen(true);
          }}
          onDelete={handleDeleteTerritory}
          selectedCountryCode={selected?.countryCode}
        />
        <RoutingRuleListPanel
          items={rItems}
          isLoading={rules.isLoading}
          isError={rules.isError}
          errorMessage={rules.error?.message}
          onRetry={() => rules.refetch()}
          onEdit={(r) => {
            setEditingRule(r);
            setRuleDialogOpen(true);
          }}
          onDelete={handleDeleteRule}
          selectedCountryCode={selected?.countryCode}
        />
      </motion.div>
    </motion.div>
  );
}
