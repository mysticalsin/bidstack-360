// Display-only sub-panels and KPI tile for TerritoriesPage.
// All data-fetching and mutation state stays in the orchestrator.
import type { LeadRoutingRule, Territory } from '@bidstack/shared';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';

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

export function CountryDetailPanel({
  selected,
  formatMoneyMicros,
}: {
  selected: TerritoryAnalyticsItem | null;
  formatMoneyMicros: (micros: number, currency: string) => string;
}) {
  return (
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
                {formatMoneyMicros(selected.totalValueMicros, 'EUR')}
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--fg-secondary)] mb-1">Territories</div>
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
}: {
  items: Territory[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onEdit: (t: Territory) => void;
  onDelete: (t: Territory) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Territories</h2>
        <span className="text-xs text-[var(--fg-tertiary)]">{items.length} total</span>
      </div>
      {isError ? (
        <ErrorState
          title="Failed to load"
          message={errorMessage}
          action={<Button onClick={onRetry}>Retry</Button>}
        />
      ) : isLoading ? (
        <TableSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState title="No territories" message="Create your first territory to get started." />
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <Card key={t.id} className="p-3 group">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--fg-primary)]">{t.name}</div>
                    {!t.active && <Badge tone="gray">Inactive</Badge>}
                  </div>
                  <div className="text-xs text-[var(--fg-secondary)]">
                    {t.region ?? 'No region'} · {t.countryCodes.join(', ') || 'Global'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-[var(--fg-tertiary)]">{t.ownerName ?? '—'}</div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100 focus-within:opacity-100">
                    <button
                      onClick={() => onEdit(t)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]"
                      title="Edit"
                    >
                      <Icon name="pencil" size={13} />
                    </button>
                    <button
                      onClick={() => onDelete(t)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)]"
                      title="Delete"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
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
}: {
  items: LeadRoutingRule[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onEdit: (r: LeadRoutingRule) => void;
  onDelete: (r: LeadRoutingRule) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Lead Routing Rules</h2>
        <span className="text-xs text-[var(--fg-tertiary)]">{items.length} total</span>
      </div>
      {isError ? (
        <ErrorState
          title="Failed to load"
          message={errorMessage}
          action={<Button onClick={onRetry}>Retry</Button>}
        />
      ) : isLoading ? (
        <TableSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No routing rules"
          message="Create your first rule to auto-assign leads."
        />
      ) : (
        <div className="space-y-2">
          {items.map((r) => {
            const criteria = r.criteria as Record<string, unknown>;
            return (
              <Card key={r.id} className="p-3 group">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-[var(--fg-primary)]">{r.name}</div>
                      {!r.active && <Badge tone="gray">Inactive</Badge>}
                      {criteria.countryCode ? (
                        <Badge tone="blue">{String(criteria.countryCode)}</Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-[var(--fg-secondary)]">
                      Priority {r.priority} ·{' '}
                      {r.assignToUserId
                        ? 'Assign to user'
                        : r.assignToTerritoryId
                          ? 'Assign to territory'
                          : r.roundRobinTeam.length > 0
                            ? `Round robin (${r.roundRobinTeam.length})`
                            : 'No assignment'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100 focus-within:opacity-100">
                    <button
                      onClick={() => onEdit(r)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]"
                      title="Edit"
                    >
                      <Icon name="pencil" size={13} />
                    </button>
                    <button
                      onClick={() => onDelete(r)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)]"
                      title="Delete"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
