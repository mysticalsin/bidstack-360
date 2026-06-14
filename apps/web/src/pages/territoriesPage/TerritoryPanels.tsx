// Display-only sub-panels and KPI tile for TerritoriesPage.
// All data-fetching and mutation state stays in the orchestrator.
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { LeadRoutingRule, Territory } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';

import { cn } from '@/lib/cn';
import type { TerritoryAnalyticsItem } from '@/hooks/useTerritories';

export function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'blue' | 'jade' | 'amber' | 'purple';
}) {
  const config = {
    blue: {
      dot: '#2c4bff',
      bg: 'rgba(44, 75, 255, 0.08)',
      fg: 'text-[#2c4bff] dark:text-[#7882e7]',
      icon: 'dollar' as IconName,
    },
    jade: {
      dot: '#059669',
      bg: 'rgba(5, 150, 105, 0.08)',
      fg: 'text-[#059669] dark:text-[#34d399]',
      icon: 'globe' as IconName,
    },
    amber: {
      dot: '#d97706',
      bg: 'rgba(217, 119, 6, 0.08)',
      fg: 'text-[#d97706] dark:text-[#fbbf24]',
      icon: 'target' as IconName,
    },
    purple: {
      dot: '#7c3aed',
      bg: 'rgba(124, 58, 237, 0.08)',
      fg: 'text-[#7c3aed] dark:text-[#a78bfa]',
      icon: 'sparkle' as IconName,
    },
  }[tone];

  return (
    <motion.div
      whileHover={{ y: -2, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)] hover:shadow-[var(--shadow-sm)] transition-shadow duration-200"
    >
      {/* Background glow overlay */}
      <div
        className="absolute -right-6 -top-6 h-16 w-16 rounded-full blur-2xl opacity-30 pointer-events-none"
        style={{ backgroundColor: config.dot }}
      />
      <div className="flex items-center justify-between gap-3 relative z-10">
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">
            {label}
          </span>
          <div className="text-xl font-extrabold text-[var(--fg-primary)] tabular-nums tracking-tight">
            {value}
          </div>
        </div>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
          style={{ backgroundColor: config.bg }}
        >
          <Icon name={config.icon} size={18} className={config.fg} />
        </div>
      </div>
    </motion.div>
  );
}

export function CountryDetailPanel({
  selected,
  formatMoneyMicros,
  globalTotals,
  onClear,
}: {
  selected: TerritoryAnalyticsItem | null;
  formatMoneyMicros: (micros: number, currency: string) => string;
  globalTotals?: { totalValueMicros: number } | null;
  onClear?: () => void;
}) {
  const { t } = useTranslation('crm');
  const sharePct =
    selected && globalTotals && globalTotals.totalValueMicros > 0
      ? (selected.totalValueMicros / globalTotals.totalValueMicros) * 100
      : 0;

  return (
    <Card
      className={
        selected ? 'transition-all duration-300' : 'opacity-70 transition-all duration-300'
      }
    >
      <SectionHeader
        title={
          selected
            ? t('territoryPanels.countryDetailTitleWithCode', '{{countryCode}} Detail', {
                countryCode: selected.countryCode,
              })
            : t('territoryPanels.countryDetailTitle', 'Country Detail')
        }
        caption={selected ? undefined : t('territoryPanels.clickCountryHint', 'Click a country on the map')}
        action={
          selected && onClear ? (
            <button
              onClick={onClear}
              className="text-[10px] font-bold text-[var(--fg-tertiary)] hover:text-[var(--brand-primary)] px-2 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] transition-all cursor-pointer active:scale-95"
            >
              {t('territoryPanels.clear', 'Clear')}
            </button>
          ) : undefined
        }
      />
      {selected ? (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 p-3 hover:bg-[var(--surface-sunken)] transition-colors duration-150">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)] flex items-center gap-1.5">
                <Icon name="target" size={10} className="text-amber-500" />
                {t('territoryPanels.opportunities', 'Opportunities')}
              </div>
              <div className="mt-1 text-2xl font-extrabold text-[var(--fg-primary)] tabular-nums">
                {selected.opportunityCount}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 p-3 hover:bg-[var(--surface-sunken)] transition-colors duration-150">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)] flex items-center gap-1.5">
                <Icon name="dollar" size={10} className="text-blue-500" />
                {t('territoryPanels.pipeline', 'Pipeline')}
              </div>
              <div className="mt-1 text-2xl font-extrabold text-[var(--fg-primary)] tabular-nums">
                {formatMoneyMicros(selected.totalValueMicros, 'EUR')}
              </div>
            </div>
          </div>

          {globalTotals && globalTotals.totalValueMicros > 0 && (
            <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">
                <span className="flex items-center gap-1.5">
                  <Icon name="activity" size={11} className="text-emerald-500" />
                  {t('territoryPanels.globalPipelineShare', 'Global Pipeline Share')}
                </span>
                <span className="font-extrabold text-[var(--fg-primary)] tabular-nums">
                  {sharePct.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 dark:from-[var(--brand-primary)] dark:to-[var(--success-fg)] rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, sharePct))}%` }}
                />
              </div>
            </div>
          )}

          <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)] mb-2 flex items-center gap-1.5">
                <Icon name="git-branch" size={11} className="text-purple-500" />
                {t('territoryPanels.assignedTerritories', 'Assigned Territories')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.territories.length > 0 ? (
                  selected.territories.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--fg-secondary)] shadow-sm hover:border-[var(--brand-primary)] transition-all duration-150 cursor-default"
                    >
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-[var(--fg-tertiary)] italic">
                    {t('territoryPanels.noTerritoriesAssigned', 'No territories assigned')}
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)] mb-2 flex items-center gap-1.5">
                <Icon name="user" size={11} className="text-emerald-500" />
                {t('territoryPanels.accountOwners', 'Account Owners')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.ownerNames.length > 0 ? (
                  selected.ownerNames.map((o) => (
                    <span
                      key={o}
                      className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--fg-secondary)] shadow-sm"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                      {o}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-[var(--fg-tertiary)] italic">{t('territoryPanels.noActiveOwners', 'No active owners')}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col h-48 items-center justify-center text-center p-4">
          <div className="rounded-full bg-[var(--surface-sunken)] p-3 mb-2.5 text-[var(--fg-tertiary)] animate-pulse">
            <Icon name="globe" size={24} />
          </div>
          <span className="text-xs font-semibold text-[var(--fg-secondary)]">
            {t('territoryPanels.noCountrySelected', 'No Country Selected')}
          </span>
          <span className="text-[11px] text-[var(--fg-tertiary)] mt-1.5 max-w-[200px]">
            {t(
              'territoryPanels.noCountrySelectedHint',
              'Click any active territory on the interactive map above to load metrics.',
            )}
          </span>
        </div>
      )}
    </Card>
  );
}

export function TerritoryListPanel({
  items,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  onEdit,
  onDelete,
  selectedCountryCode,
}: {
  items: Territory[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onEdit: (t: Territory) => void;
  onDelete: (t: Territory) => void;
  selectedCountryCode?: string | null;
}) {
  const { t } = useTranslation('crm');
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)] flex items-center gap-1.5">
          <Icon name="building" size={14} className="text-indigo-500" />
          {t('territoryPanels.territories', 'Territories')}
        </h2>
        <span className="text-xs text-[var(--fg-tertiary)] tabular-nums">
          {t('territoryPanels.countTotal', '{{count}} total', { count: items.length })}
        </span>
      </div>
      {isError ? (
        <ErrorState
          title={t('territoryPanels.failedToLoad', 'Failed to load')}
          message={errorMessage}
          action={<Button onClick={onRetry}>{t('territoryPanels.retry', 'Retry')}</Button>}
        />
      ) : isLoading ? (
        <TableSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('territoryPanels.noTerritories', 'No territories')}
          message={t(
            'territoryPanels.noTerritoriesHint',
            'Create your first territory to get started.',
          )}
        />
      ) : (
        <div className="space-y-2">
          {items.map((territory) => {
            const isMatch =
              !selectedCountryCode ||
              territory.countryCodes.includes(selectedCountryCode) ||
              territory.countryCodes.length === 0;

            return (
              <motion.div
                layout
                whileHover={isMatch ? { y: -1 } : undefined}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                key={territory.id}
                style={{
                  opacity: isMatch ? 1 : 0.4,
                  filter: isMatch ? 'none' : 'blur(0.2px)',
                  transition: 'opacity 200ms ease, filter 200ms ease',
                }}
              >
                <Card
                  className={cn(
                    'p-3 group transition-all duration-200',
                    isMatch
                      ? 'hover:border-[var(--brand-primary)] focus-within:border-[var(--brand-primary)] focus-within:ring-2 focus-within:ring-[var(--ring)]'
                      : 'pointer-events-none',
                  )}
                  style={
                    selectedCountryCode && isMatch && territory.countryCodes.length > 0
                      ? {
                          borderColor: 'var(--brand-primary)',
                          boxShadow: '0 0 12px rgba(168,85,247,0.1)',
                        }
                      : undefined
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-semibold text-[var(--fg-primary)] tracking-tight truncate">
                          {territory.name}
                        </div>
                        {territory.active ? (
                          <span className="inline-flex items-center rounded-full bg-[var(--success-surface)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--success-fg)] tracking-wide uppercase">
                            {t('territoryPanels.active', 'Active')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--fg-tertiary)] tracking-wide uppercase">
                            {t('territoryPanels.inactive', 'Inactive')}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--fg-secondary)] mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-indigo-500/80 dark:text-indigo-400/80">
                          {territory.region ?? t('territoryPanels.global', 'Global')}
                        </span>
                        <span className="text-[var(--border-strong)]">·</span>
                        <span className="truncate" title={territory.countryCodes.join(', ')}>
                          {territory.countryCodes.length > 0
                            ? t(
                                'territoryPanels.countryCountSummary',
                                '{{count}} countries ({{preview}})',
                                {
                                  count: territory.countryCodes.length,
                                  preview: `${territory.countryCodes.slice(0, 3).join(', ')}${
                                    territory.countryCodes.length > 3 ? '...' : ''
                                  }`,
                                  defaultValue_one: '{{count}} country ({{preview}})',
                                },
                              )
                            : t('territoryPanels.allCountries', 'All Countries')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-[10px] font-semibold text-[var(--fg-secondary)] flex items-center gap-1 bg-[var(--surface-sunken)]/60 px-2 py-0.5 rounded-md border border-[var(--border-subtle)]">
                        <Icon name="user" size={10} className="text-[var(--fg-tertiary)]" />
                        {territory.ownerName ?? t('territoryPanels.unassigned', 'Unassigned')}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                        <button
                          onClick={() => onEdit(territory)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--brand-primary-tint)] hover:text-[var(--brand-primary)] active:scale-95 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                          title={t('territoryPanels.edit', 'Edit')}
                        >
                          <Icon name="pencil" size={13} />
                        </button>
                        <button
                          onClick={() => onDelete(territory)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--error-surface)] hover:text-[var(--fg-error)] active:scale-95 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                          title={t('territoryPanels.delete', 'Delete')}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RoutingRuleListPanel({
  items,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  onEdit,
  onDelete,
  selectedCountryCode,
}: {
  items: LeadRoutingRule[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onEdit: (r: LeadRoutingRule) => void;
  onDelete: (r: LeadRoutingRule) => void;
  selectedCountryCode?: string | null;
}) {
  const { t } = useTranslation('crm');
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)] flex items-center gap-1.5">
          <Icon name="git-branch" size={14} className="text-purple-500" />
          {t('territoryPanels.leadRoutingRules', 'Lead Routing Rules')}
        </h2>
        <span className="text-xs text-[var(--fg-tertiary)] tabular-nums">
          {t('territoryPanels.countTotal', '{{count}} total', { count: items.length })}
        </span>
      </div>
      {isError ? (
        <ErrorState
          title={t('territoryPanels.failedToLoad', 'Failed to load')}
          message={errorMessage}
          action={<Button onClick={onRetry}>{t('territoryPanels.retry', 'Retry')}</Button>}
        />
      ) : isLoading ? (
        <TableSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('territoryPanels.noRoutingRules', 'No routing rules')}
          message={t(
            'territoryPanels.noRoutingRulesHint',
            'Create your first rule to auto-assign leads.',
          )}
        />
      ) : (
        <div className="space-y-2">
          {items.map((r) => {
            const criteria = r.criteria as Record<string, unknown>;
            const assignText = r.assignToUserId
              ? t('territoryPanels.assignUser', 'User')
              : r.assignToTerritoryId
                ? t('territoryPanels.assignTerritory', 'Territory')
                : r.roundRobinTeam && r.roundRobinTeam.length > 0
                  ? t('territoryPanels.assignRoundRobin', 'Round Robin ({{count}})', {
                      count: r.roundRobinTeam.length,
                    })
                  : t('territoryPanels.assignNone', 'None');
            const assignIcon = r.assignToUserId
              ? ('user' as IconName)
              : r.assignToTerritoryId
                ? ('globe' as IconName)
                : ('refresh' as IconName);

            const isMatch =
              !selectedCountryCode ||
              criteria.countryCode === selectedCountryCode ||
              !criteria.countryCode;

            return (
              <motion.div
                layout
                whileHover={isMatch ? { y: -1 } : undefined}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                key={r.id}
                style={{
                  opacity: isMatch ? 1 : 0.4,
                  filter: isMatch ? 'none' : 'blur(0.2px)',
                  transition: 'opacity 200ms ease, filter 200ms ease',
                }}
              >
                <Card
                  className={cn(
                    'p-3 group transition-all duration-200',
                    isMatch
                      ? 'hover:border-[var(--brand-primary)] focus-within:border-[var(--brand-primary)] focus-within:ring-2 focus-within:ring-[var(--ring)]'
                      : 'pointer-events-none',
                  )}
                  style={
                    selectedCountryCode && isMatch && criteria.countryCode
                      ? {
                          borderColor: 'var(--brand-primary)',
                          boxShadow: '0 0 12px rgba(168,85,247,0.1)',
                        }
                      : undefined
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-semibold text-[var(--fg-primary)] tracking-tight truncate">
                          {r.name}
                        </div>
                        {r.active ? (
                          <span className="inline-flex items-center rounded-full bg-[var(--success-surface)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--success-fg)] tracking-wide uppercase">
                            {t('territoryPanels.active', 'Active')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--fg-tertiary)] tracking-wide uppercase">
                            {t('territoryPanels.inactive', 'Inactive')}
                          </span>
                        )}
                        {criteria.countryCode ? (
                          <span className="inline-flex items-center rounded-full bg-[var(--brand-primary-tint)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--brand-primary)] tracking-wide uppercase">
                            {String(criteria.countryCode)}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-[var(--fg-secondary)] mt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-[var(--fg-tertiary)]">
                          {t('territoryPanels.priority', 'Priority {{priority}}', {
                            priority: r.priority,
                          })}
                        </span>
                        <span className="text-[var(--border-strong)]">·</span>
                        <span className="inline-flex items-center gap-1 text-violet-500 font-semibold dark:text-violet-400">
                          <Icon name={assignIcon} size={10} />
                          {assignText}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                      <button
                        onClick={() => onEdit(r)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--brand-primary-tint)] hover:text-[var(--brand-primary)] active:scale-95 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                        title={t('territoryPanels.edit', 'Edit')}
                      >
                        <Icon name="pencil" size={13} />
                      </button>
                      <button
                        onClick={() => onDelete(r)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--error-surface)] hover:text-[var(--fg-error)] active:scale-95 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                        title={t('territoryPanels.delete', 'Delete')}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
