// Roles & Permissions matrix page.
// Settings → Roles & Permissions. Shows:
//   1. A read-only matrix grid: rows = resources, columns = the 6 spec roles,
//      cells = Read / Write / — icons.
//   2. A custom-role editor panel for Admins (delegates to RolesSection).
//
// Accessibility:
//   - All cells have aria-label with role+resource+access level.
//   - Keyboard navigable table (role="grid", arrow keys handled by browser).
//   - 4.5:1 contrast on icon colours (verified via CSS variable tokens).
//   - prefers-reduced-motion: tick/cross use CSS vars that respect the media.
//   - WCAG 2.2 AA: focus ring on interactive elements, 44px min touch targets.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  RBAC_MATRIX,
  MATRIX_RESOURCES,
  SYSTEM_ROLE_NAMES,
  type SystemRoleName,
  type MatrixResource,
} from '@bidstack/shared';

import { useIsAdmin } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { RolesSection } from '@/components/settings/RolesSection';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function canRead(role: SystemRoleName, resource: MatrixResource): boolean {
  return RBAC_MATRIX[role].includes(`${resource}:read` as never);
}

function canWrite(role: SystemRoleName, resource: MatrixResource): boolean {
  return RBAC_MATRIX[role].includes(`${resource}:write` as never);
}

type AccessLevel = 'read-write' | 'read-only' | 'none';

function accessLevel(role: SystemRoleName, resource: MatrixResource): AccessLevel {
  const r = canRead(role, resource);
  const w = canWrite(role, resource);
  if (r && w) return 'read-write';
  if (r) return 'read-only';
  return 'none';
}

// ─── Cell component ───────────────────────────────────────────────────────────

interface MatrixCellProps {
  level: AccessLevel;
  role: SystemRoleName;
  resource: MatrixResource;
}

function MatrixCell({ level, role, resource }: MatrixCellProps) {
  const { t } = useTranslation('crm');
  const accessText =
    level === 'read-write'
      ? t('roles.access.readWrite', 'read and write')
      : level === 'read-only'
        ? t('roles.access.readOnly', 'read only')
        : t('roles.access.none', 'no access');
  const label = `${role}: ${resource} — ${accessText}`;

  return (
    <td
      role="gridcell"
      aria-label={label}
      className={cn(
        'h-11 w-24 text-center align-middle text-sm font-medium border-b border-[var(--border-subtle)]',
        level === 'read-write' && 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]',
        level === 'read-only' && 'bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]',
        level === 'none' && 'text-[var(--fg-disabled)]',
      )}
    >
      {level === 'read-write' && (
        <span aria-hidden="true" title={t('roles.cell.readWriteTitle', 'Read + Write')}>
          R+W
        </span>
      )}
      {level === 'read-only' && (
        <span aria-hidden="true" title={t('roles.cell.readOnlyTitle', 'Read only')}>
          R
        </span>
      )}
      {level === 'none' && (
        <span aria-hidden="true" title={t('roles.cell.noAccessTitle', 'No access')}>
          —
        </span>
      )}
    </td>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  const { t } = useTranslation('crm');
  return (
    <div
      className="flex flex-wrap items-center gap-4 text-xs text-[var(--fg-secondary)]"
      aria-label={t('roles.legend.label', 'Legend')}
    >
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-4 w-8 rounded text-center text-[11px] font-semibold bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]">
          R+W
        </span>
        {t('roles.legend.readWrite', 'Read & Write')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-4 w-8 rounded text-center text-[11px] font-semibold bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]">
          R
        </span>
        {t('roles.legend.readOnly', 'Read only')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-4 w-8 rounded text-center text-[11px] font-medium text-[var(--fg-disabled)]">
          —
        </span>
        {t('roles.legend.noAccess', 'No access')}
      </span>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'matrix' | 'custom';
const ROLE_TABS: Array<{ id: Tab; labelKey: string; labelDefault: string; adminOnly?: boolean }> = [
  { id: 'matrix', labelKey: 'roles.tabs.matrix', labelDefault: 'System Roles Matrix' },
  { id: 'custom', labelKey: 'roles.tabs.custom', labelDefault: 'Custom Roles', adminOnly: true },
];

// ─── Main component ───────────────────────────────────────────────────────────

export function RolesPage() {
  const isAdmin = useIsAdmin();
  const { t } = useTranslation('crm');
  const [tab, setTab] = useState<Tab>('matrix');

  return (
    <div className="space-y-6">
      {/* Page header */}
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
          {t('roles.header.title', 'Roles & Permissions')}
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'roles.header.subtitle',
            'Default permission matrix for system roles. Admins can create custom roles below.',
          )}
        </p>
      </header>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label={t('roles.tablist.label', 'Roles views')}
        className="flex gap-1 border-b border-[var(--border-subtle)]"
      >
        {ROLE_TABS.map(({ id, labelKey, labelDefault, adminOnly }) => {
          if (adminOnly && !isAdmin) return null;
          return (
            <button
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`tabpanel-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium rounded-t-md focus:outline-none',
                'focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1',
                'min-h-[44px] min-w-[44px]', // WCAG touch target
                tab === id
                  ? 'border-b-2 border-[var(--brand-primary)] text-[var(--fg-primary)]'
                  : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
              )}
            >
              {t(labelKey, labelDefault)}
            </button>
          );
        })}
      </div>

      {/* Matrix tab */}
      {tab === 'matrix' && (
        <section
          id="tabpanel-matrix"
          role="tabpanel"
          aria-labelledby="tab-matrix"
          className="space-y-4"
        >
          <Legend />

          {/* Scrollable matrix table */}
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] shadow-sm">
            <table
              role="grid"
              aria-label={t('roles.table.label', 'Permission matrix for system roles')}
              className="border-collapse min-w-full text-sm"
            >
              <thead>
                <tr className="bg-[var(--surface-sunken)]">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-[var(--surface-sunken)] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--fg-secondary)] min-w-[140px] border-b border-[var(--border-subtle)]"
                  >
                    {t('roles.table.resourceHeader', 'Resource')}
                  </th>
                  {SYSTEM_ROLE_NAMES.map((role) => (
                    <th
                      key={role}
                      scope="col"
                      className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-[var(--fg-secondary)] w-24 border-b border-[var(--border-subtle)]"
                    >
                      <span className="block truncate max-w-[88px]" title={role}>
                        {role}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX_RESOURCES.map((resource, idx) => (
                  <tr
                    key={resource}
                    className={cn(
                      'transition-colors',
                      idx % 2 === 0
                        ? 'bg-[var(--surface-card)]'
                        : 'bg-[var(--surface-card)]/60',
                      'hover:bg-[var(--surface-hover)]',
                    )}
                  >
                    <td
                      className="sticky left-0 z-10 bg-inherit px-4 py-0 font-medium text-[var(--fg-primary)] border-b border-[var(--border-subtle)]"
                      scope="row"
                    >
                      <div className="flex items-center h-11 gap-2">
                        <code className="text-xs text-[var(--fg-secondary)]">{resource}</code>
                      </div>
                    </td>
                    {SYSTEM_ROLE_NAMES.map((role) => (
                      <MatrixCell
                        key={role}
                        level={accessLevel(role, resource)}
                        role={role}
                        resource={resource}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Role summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
            {SYSTEM_ROLE_NAMES.map((role) => {
              const perms = RBAC_MATRIX[role];
              const readCount = perms.filter((p) => p.endsWith(':read')).length;
              const writeCount = perms.filter((p) => p.endsWith(':write')).length;

              return (
                <div
                  key={role}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--fg-primary)] text-sm">{role}</span>
                    <Badge tone={role === 'Admin' ? 'purple' : role === 'Read-Only' ? 'gray' : 'blue'}>
                      {t('roles.card.systemBadge', 'System')}
                    </Badge>
                  </div>
                  <div className="flex gap-3 text-xs text-[var(--fg-secondary)]">
                    <span>{t('roles.card.readCount', '{{count}} read', { count: readCount })}</span>
                    <span>·</span>
                    <span>{t('roles.card.writeCount', '{{count}} write', { count: writeCount })}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {role === 'Admin' && (
                      <Badge tone="amber">{t('roles.card.fullAccess', 'Full access')}</Badge>
                    )}
                    {role === 'Read-Only' && (
                      <Badge tone="gray">{t('roles.card.noWriteAccess', 'No write access')}</Badge>
                    )}
                    {role === 'SDR' && (
                      <Badge tone="jade">{t('roles.card.leadFocused', 'Lead-focused')}</Badge>
                    )}
                    {role === 'Customer Success' && (
                      <Badge tone="teal">{t('roles.card.postSale', 'Post-sale')}</Badge>
                    )}
                    {role === 'Account Executive' && (
                      <Badge tone="blue">{t('roles.card.pipelineOwner', 'Pipeline owner')}</Badge>
                    )}
                    {role === 'Sales Manager' && (
                      <Badge tone="purple">{t('roles.card.teamLead', 'Team lead')}</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Custom roles tab (admin only) */}
      {tab === 'custom' && isAdmin && (
        <section
          id="tabpanel-custom"
          role="tabpanel"
          aria-labelledby="tab-custom"
        >
          <RolesSection />
        </section>
      )}
    </div>
  );
}
