import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useRoles } from '@/hooks/useRoles';
import { useUserRoles, useAssignUserRole, useRevokeUserRole } from '@/hooks/useUsers';

interface Props {
  userId: string;
  userName: string;
}

/**
 * Admin surface for granting/revoking granular custom roles on one user. Loaded
 * lazily when a Team row is expanded. This is what connects the seeded RBAC
 * roles to the product — assign a role here and the user's permissions change.
 */
export function UserRolesManager({ userId, userName }: Props) {
  const { t } = useTranslation('settings');
  const assignedQuery = useUserRoles(userId);
  const allRoles = useRoles();
  const assign = useAssignUserRole(userId);
  const revoke = useRevokeUserRole(userId);
  const [pickerValue, setPickerValue] = useState('');

  // An unread grant is not an empty assignment. An unread catalog is not a
  // full one. Assign stays hidden until both reads have arrived.
  const assignedList =
    !assignedQuery.isPending && !assignedQuery.isError && assignedQuery.data !== undefined
      ? assignedQuery.data
      : null;
  const catalog =
    !allRoles.isPending && !allRoles.isError && allRoles.data !== undefined ? allRoles.data : null;
  const assignedIds = new Set((assignedList ?? []).map((role) => role.roleId));
  const assignable = (catalog?.items ?? []).filter((role) => !assignedIds.has(role.id));

  function onAssign() {
    if (!pickerValue) return;
    assign.mutate(pickerValue, { onSuccess: () => setPickerValue('') });
  }

  return (
    <div className="rounded-md bg-[var(--surface-sunken)] p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
        {t('userRolesManager.heading', 'Roles for {{userName}}', { userName })}
      </p>

      {assignedQuery.isPending ? (
        <p role="status" className="text-sm text-[var(--fg-secondary)]">
          {t('userRolesManager.checking', 'Checking roles for {{userName}}.', { userName })}
        </p>
      ) : assignedList === null ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {t(
            'userRolesManager.failed',
            'Could not load roles for {{userName}}. The saved roles have not arrived.',
            { userName },
          )}
        </p>
      ) : assignedList.length === 0 ? (
        <p className="text-sm text-[var(--fg-secondary)]">
          {t('userRolesManager.empty', 'No custom roles assigned yet.')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {assignedList.map((r) => (
            <span key={r.roleId} className="inline-flex items-center gap-1">
              <Badge tone="purple">{r.name}</Badge>
              <button
                type="button"
                className="iconbtn h-6 w-6"
                aria-label={t('userRolesManager.revokeAriaLabel', 'Revoke {{roleName}} from {{userName}}', {
                  roleName: r.name,
                  userName,
                })}
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(r.roleId)}
              >
                <Icon name="close" size={12} ariaHidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {assignedList !== null && allRoles.isPending ? (
        <p role="status" className="mt-3 text-sm text-[var(--fg-secondary)]">
          {t('userRolesManager.catalogChecking', 'Checking the role list.')}
        </p>
      ) : null}

      {assignedList !== null && !allRoles.isPending && catalog === null ? (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {t(
            'userRolesManager.catalogFailed',
            'Could not load the role list. The saved roles have not arrived.',
          )}
        </p>
      ) : null}

      {assignedList !== null && catalog !== null ? (
        <div className="mt-3 flex items-center gap-2">
          <label className="sr-only" htmlFor={`assign-role-${userId}`}>
            {t('userRolesManager.assignLabel', 'Assign a role to {{userName}}', { userName })}
          </label>
          <select
            id={`assign-role-${userId}`}
            className="input max-w-[16rem]"
            value={pickerValue}
            onChange={(e) => setPickerValue(e.target.value)}
            disabled={assignable.length === 0}
          >
            <option value="">
              {assignable.length === 0
                ? t('userRolesManager.allAssigned', 'All roles assigned')
                : t('userRolesManager.selectPlaceholder', 'Select a role to assign…')}
            </option>
            {assignable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!pickerValue || assign.isPending}
            onClick={onAssign}
          >
            {assign.isPending
              ? t('userRolesManager.assigning', 'Assigning…')
              : t('userRolesManager.assign', 'Assign')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
