// AnalyticsDashboardPage — /analytics-dashboard
// The user's main analytics workspace. Drag-resizable widget grid.
// Allows switching between dashboards via a dropdown.
// Uses a CSS grid + drag-to-reorder via mouse events (no external dep beyond
// what's already in the bundle: framer-motion handles smooth reordering).

import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, Reorder } from 'framer-motion';
import { Plus, ChevronDown, BarChart2, LayoutDashboard, Settings2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { WidgetRenderer } from '@/components/widgets/WidgetRenderer';
import { WidgetConfigModal } from '@/components/widgets/WidgetConfigModal';
import { useHasPermission } from '@/hooks/useCapabilities';
import {
  useDashboards,
  useDashboardWidgets,
  useAddWidget,
  useDeleteWidget,
  type DashboardWidget,
  type CreateWidgetInput,
} from '@/hooks/useDashboards';

export function AnalyticsDashboardPage() {
  const { t } = useTranslation('crm');
  const [searchParams] = useSearchParams();
  const { data: dashboards = [], isLoading: dashLoading } = useDashboards();
  // Initialise from ?id= so deep-links and the Dashboards list (which links
  // to /analytics?id=<id>) open the chosen dashboard instead of always the first.
  const [activeDashId, setActiveDashId] = useState<string>(searchParams.get('id') ?? '');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [addingWidget, setAddingWidget] = useState(false);
  // Add/delete widget both persist through POST/DELETE
  // /api/dashboards/:id/widgets*, gated server-side behind reports:write
  // (apps/api/src/routes/analytics-dashboards.ts:94,139) — hide the write
  // affordances rather than let a read-only role 403.
  const canWrite = useHasPermission('reports:write');

  // Resolve the active dashboard (default to first). Fall back to the first
  // dashboard when ?id points at a stale/foreign/deleted id, so a bad deep-link
  // shows a real dashboard instead of the false "No dashboards" empty state.
  const activeDash =
    (activeDashId ? dashboards.find((d) => d.id === activeDashId) : undefined) ?? dashboards[0];

  const {
    data: rawWidgets = [],
    isLoading: widgetsLoading,
    error: widgetsError,
  } = useDashboardWidgets(activeDash?.id ?? '');

  // Local widget order (for drag-reorder; persists on next re-fetch)
  const [localOrder, setLocalOrder] = useState<DashboardWidget[]>([]);
  // Reconcile the manual drag-order with server truth DURING RENDER (no effect —
  // avoids cascading setState): keep the user's order for survivors, append
  // newly-added widgets, drop deleted ones. Without this, after a reorder a
  // deleted widget kept showing and a new one never appeared (localOrder shadowed
  // rawWidgets until a dashboard switch).
  const widgets = useMemo(() => {
    if (localOrder.length === 0) return rawWidgets;
    const byId = new Map(rawWidgets.map((w) => [w.id, w]));
    const kept = localOrder.filter((w) => byId.has(w.id)).map((w) => byId.get(w.id)!);
    const added = rawWidgets.filter((w) => !localOrder.some((p) => p.id === w.id));
    return [...kept, ...added];
  }, [localOrder, rawWidgets]);

  const addWidgetMutation = useAddWidget(activeDash?.id ?? '');
  const deleteWidgetMutation = useDeleteWidget(activeDash?.id ?? '');

  const handleAddWidget = useCallback(
    async (cfg: CreateWidgetInput) => {
      if (!activeDash) return;
      // useAddWidget's onError already toasts; just propagate the rejection so
      // WidgetConfigModal keeps the dialog open (with the user's input) on failure
      // instead of closing as if the widget saved.
      await addWidgetMutation.mutateAsync(cfg);
    },
    [activeDash, addWidgetMutation],
  );

  const handleDeleteWidget = useCallback(
    (widgetId: string) => {
      if (!activeDash) return;
      if (!confirm(t('analyticsDashboard.confirmRemoveWidget', 'Remove this widget?'))) return;
      deleteWidgetMutation.mutate(widgetId);
    },
    [activeDash, deleteWidgetMutation, t],
  );

  if (dashLoading) {
    return (
      <div className="p-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-52 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Topbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-card)] dark:bg-[var(--surface-glass)]">
        <BarChart2 size={18} className="text-[var(--brand-primary)]" aria-hidden />
        <h1 className="text-sm font-semibold text-[var(--fg-primary)]">{t('analyticsDashboard.title', 'Analytics')}</h1>

        {/* Dashboard switcher */}
        <div className="relative ml-2">
          <button
            onClick={() => setDropdownOpen((p) => !p)}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            aria-label={t('analyticsDashboard.switchDashboardAria', 'Switch dashboard')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border border-[var(--border-default)]',
              'px-3 py-1.5 text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-sunken)]',
              'transition-colors min-h-[44px]',
            )}
          >
            <LayoutDashboard size={14} className="text-[var(--fg-tertiary)]" />
            <span className="max-w-[140px] truncate">{activeDash?.name ?? t('analyticsDashboard.selectDashboard', 'Select dashboard')}</span>
            <ChevronDown size={12} className="text-[var(--fg-tertiary)]" />
          </button>
          {dropdownOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              role="listbox"
              className={cn(
                'absolute left-0 top-full mt-1 z-20 min-w-[180px] rounded-lg',
                'border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-md)]',
              )}
            >
              {dashboards.map((d) => (
                <button
                  key={d.id}
                  role="option"
                  aria-selected={d.id === activeDash?.id}
                  onClick={() => {
                    setActiveDashId(d.id);
                    setLocalOrder([]);
                    setDropdownOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center px-3 py-2 text-sm min-h-[44px]',
                    d.id === activeDash?.id
                      ? 'bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
                      : 'text-[var(--fg-primary)] hover:bg-[var(--surface-sunken)]',
                  )}
                >
                  {d.name}
                </button>
              ))}
              <div className="border-t border-[var(--border-subtle)] mt-1 pt-1">
                <Link
                  to="/dashboards"
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] min-h-[44px]"
                  onClick={() => setDropdownOpen(false)}
                >
                  <Settings2 size={12} />
                  {t('analyticsDashboard.manageDashboards', 'Manage dashboards')}
                </Link>
              </div>
            </motion.div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/reports/list"
            className="text-xs text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] px-2 min-h-[44px] flex items-center"
          >
            {t('analyticsDashboard.reportsLink', 'Reports')}
          </Link>
          <Link
            to="/reports/new"
            className="text-xs text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] px-2 min-h-[44px] flex items-center"
          >
            {t('analyticsDashboard.newReportLink', 'New report')}
          </Link>
          {activeDash && canWrite && (
            <button
              onClick={() => setAddingWidget(true)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white',
                'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] transition-colors',
                'min-h-[44px]',
              )}
            >
              <Plus size={14} />
              {t('analyticsDashboard.addWidget', 'Add widget')}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {!activeDash ? (
          <EmptyState
            title={t('analyticsDashboard.noDashboardsTitle', 'No dashboards')}
            message={t(
              'analyticsDashboard.noDashboardsMessage',
              'Create your first dashboard to start visualising your data.',
            )}
            action={
              <Link
                to="/dashboards"
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium text-white min-h-[44px] inline-flex items-center',
                  'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)]',
                )}
              >
                {t('analyticsDashboard.createDashboard', 'Create dashboard')}
              </Link>
            }
          />
        ) : widgetsError ? (
          <ErrorState
            title={t('analyticsDashboard.loadWidgetsError', 'Failed to load widgets')}
            message={(widgetsError as Error).message}
          />
        ) : !widgetsLoading && widgets.length === 0 ? (
          <EmptyState
            title={t('analyticsDashboard.emptyDashboardTitle', 'Empty dashboard')}
            message={t(
              'analyticsDashboard.emptyDashboardMessage',
              'Add your first widget to start visualising data.',
            )}
            action={
              canWrite ? (
                <button
                  onClick={() => setAddingWidget(true)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white',
                    'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] min-h-[44px]',
                  )}
                >
                  <Plus size={16} />
                  {t('analyticsDashboard.addWidget', 'Add widget')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <Reorder.Group
            axis="y"
            values={widgets}
            onReorder={setLocalOrder}
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
            as="div"
          >
            {widgets.map((w) => (
              <Reorder.Item
                key={w.id}
                value={w}
                as="div"
                className="cursor-grab active:cursor-grabbing"
              >
                {/* No per-widget Configure flow exists yet (it would need a
                    widget-update endpoint + edit modal). Rather than surface a
                    dead "Configure" menu item, we omit onConfigure so the
                    action isn't rendered. Re-add when editing is implemented. */}
                <WidgetRenderer
                  widget={w}
                  onDelete={canWrite ? () => handleDeleteWidget(w.id) : undefined}
                />
              </Reorder.Item>
            ))}
          </Reorder.Group>
        )}
      </div>

      {/* Add widget modal */}
      {activeDash && canWrite && (
        <WidgetConfigModal
          open={addingWidget}
          onOpenChange={setAddingWidget}
          onSave={handleAddWidget}
        />
      )}
    </div>
  );
}
