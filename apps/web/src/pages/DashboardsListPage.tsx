// DashboardsListPage — /dashboards
// Lists all dashboards owned by the user + shared with org.
// Users can create a new dashboard or navigate to an existing one.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Plus, Layout, Globe, Lock, Trash2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { staggerParent, staggerChild } from '@/lib/motion';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { useDashboards, useCreateDashboard, useDeleteDashboard } from '@/hooks/useDashboards';

export function DashboardsListPage() {
  const { t } = useTranslation('crm');
  const { data: dashboards = [], isLoading, error } = useDashboards();
  const createMutation = useCreateDashboard();
  const deleteMutation = useDeleteDashboard();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createMutation.mutateAsync({ name: newName.trim() });
    setNewName('');
    setCreating(false);
  };

  if (isLoading) {
    return (
      <div className="p-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState
          title={t('dashboardsList.errorTitle', 'Failed to load dashboards')}
          message={(error as Error).message}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            {t('dashboardsList.heading', 'Dashboards')}
          </h1>
          <p className="text-sm text-[var(--fg-tertiary)] mt-0.5">
            {dashboards.length === 1
              ? t('dashboardsList.countOne', '{{count}} dashboard', { count: dashboards.length })
              : t('dashboardsList.countOther', '{{count}} dashboards', { count: dashboards.length })}
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white',
            'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] transition-colors',
            'min-h-[44px]',
          )}
        >
          <Plus size={16} />
          {t('dashboardsList.newButton', 'New dashboard')}
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setCreating(false);
            }}
            placeholder={t('dashboardsList.namePlaceholder', 'Dashboard name…')}
            className={cn(
              'flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
              'px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]',
              'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]',
              'min-h-[44px]',
            )}
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || createMutation.isPending}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium text-white min-h-[44px]',
              'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {createMutation.isPending
              ? t('dashboardsList.creating', 'Creating…')
              : t('dashboardsList.create', 'Create')}
          </button>
          <button
            onClick={() => setCreating(false)}
            className="px-3 py-2 text-sm text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] min-h-[44px]"
          >
            {t('dashboardsList.cancel', 'Cancel')}
          </button>
        </div>
      )}

      {/* Grid */}
      {dashboards.length === 0 ? (
        <EmptyState
          title={t('dashboardsList.emptyTitle', 'No dashboards yet')}
          message={t(
            'dashboardsList.emptyMessage',
            'Create your first dashboard to start tracking what matters.',
          )}
          action={
            <button
              onClick={() => setCreating(true)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white',
                'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] transition-colors',
                'min-h-[44px]',
              )}
            >
              <Plus size={16} />
              {t('dashboardsList.newButton', 'New dashboard')}
            </button>
          }
        />
      ) : (
        <motion.div
          variants={staggerParent}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {dashboards.map((d) => (
            <motion.div key={d.id} variants={staggerChild} className="group relative">
              <Link
                to={`/analytics?id=${d.id}`}
                className={cn(
                  'flex flex-col h-28 rounded-xl border border-[var(--border-subtle)]',
                  'bg-[var(--surface-card)] dark:bg-[var(--surface-glass)] p-4',
                  'hover:border-[var(--border-focus)] hover:shadow-[var(--shadow-sm)] transition-all',
                  'focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none',
                )}
                aria-label={t('dashboardsList.openAria', 'Open dashboard: {{name}}', {
                  name: d.name,
                })}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Layout size={16} className="text-[var(--brand-primary)] shrink-0" />
                    <span className="text-sm font-semibold text-[var(--fg-primary)] truncate max-w-[160px]">
                      {d.name}
                    </span>
                  </div>
                  {d.isShared ? (
                    <Globe
                      size={12}
                      className="text-[var(--fg-tertiary)] shrink-0"
                      aria-label={t('dashboardsList.sharedAria', 'Shared')}
                    />
                  ) : (
                    <Lock
                      size={12}
                      className="text-[var(--fg-tertiary)] shrink-0"
                      aria-label={t('dashboardsList.privateAria', 'Private')}
                    />
                  )}
                </div>
                {d.description && (
                  <p className="mt-1.5 text-xs text-[var(--fg-tertiary)] line-clamp-2">
                    {d.description}
                  </p>
                )}
                <p className="mt-auto text-[10px] text-[var(--fg-muted)] pt-2">
                  {new Date(d.updatedAt).toLocaleDateString()}
                </p>
              </Link>

              {/* Delete affordance */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  if (confirm(t('dashboardsList.deleteConfirm', 'Delete "{{name}}"?', { name: d.name }))) {
                    deleteMutation.mutate(d.id);
                  }
                }}
                aria-label={t('dashboardsList.deleteAria', 'Delete dashboard {{name}}', {
                  name: d.name,
                })}
                className={cn(
                  'absolute top-2 right-2 hidden group-hover:flex items-center justify-center',
                  'w-7 h-7 rounded-lg text-[var(--fg-tertiary)]',
                  'hover:text-[var(--danger)] hover:bg-[var(--danger-tint)] transition-colors',
                  'min-w-[44px] min-h-[44px]',
                )}
              >
                <Trash2 size={13} />
              </button>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
