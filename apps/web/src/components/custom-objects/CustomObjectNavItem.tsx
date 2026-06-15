/**
 * Sidebar nav item for a custom object type.
 *
 * Renders an icon dot (colored with the def's color), the plural label, and
 * an optional record count badge. Appears in the sidebar once an admin has
 * defined at least one custom object.
 *
 * Accessibility: inherits nav landmark from parent Sidebar; uses NavLink for
 * active-state aria-current. Touch target ≥ 44×44px per WCAG 2.2.
 */
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface CustomObjectNavItemProps {
  objectKey: string;
  labelPlural: string;
  icon: string;
  color: string;
  recordCount?: number;
  collapsed?: boolean;
}

export function CustomObjectNavItem({
  objectKey,
  labelPlural,
  color,
  recordCount,
  collapsed = false,
}: CustomObjectNavItemProps) {
  const { t } = useTranslation('crm');
  return (
    <NavLink
      to={`/o/${objectKey}`}
      data-testid={`nav-custom-object-${objectKey}`}
      className={({ isActive }) =>
        cn(
          // min-h-[44px] ensures WCAG 2.2 AA touch target
          'flex items-center gap-2.5 min-h-[44px] px-3 rounded-md text-sm font-medium transition-colors',
          'text-[var(--sidebar-fg)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-fg-active)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1',
          isActive && 'bg-[var(--sidebar-active)] text-[var(--sidebar-fg-active)]',
          collapsed && 'justify-center px-2',
        )
      }
      aria-label={collapsed ? labelPlural : undefined}
    >
      {/* Colored dot replaces icon for custom objects — keeps sidebar scannable */}
      <span
        className="flex-shrink-0 w-4 h-4 rounded-sm"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{labelPlural}</span>
          {recordCount !== undefined && recordCount > 0 && (
            <span
              className="ml-auto text-xs font-medium tabular-nums text-[var(--sidebar-badge-fg)] bg-[var(--sidebar-badge-bg)] rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center"
              aria-label={t('customObjectNavItem.recordCountLabel', '{{count}} records', { count: recordCount })}
            >
              {recordCount > 999 ? '999+' : recordCount}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}
