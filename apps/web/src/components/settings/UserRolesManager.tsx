import { useState } from 'react';

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
  const assignedQuery = useUserRoles(userId);
  const allRoles = useRoles();
  const assign = useAssignUserRole(userId);
  const revoke = useRevokeUserRole(userId);
  const [pickerValue, setPickerValue] = useState('');

  const assigned = assignedQuery.data ?? [];
  const assignedIds = new Set(assigned.map((r) => r.roleId));
  const assignable = (allRoles.data ?? []).filter((r) => !assignedIds.has(r.id));

  function onAssign() {
    if (!pickerValue) return;
    assign.mutate(pickerValue, { onSuccess: () => setPickerValue('') });
  }

  return (
    <div className="rounded-md bg-[var(--surface-sunken)] p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
        Roles for {userName}
      </p>

      {assignedQuery.isError ? (
        <p className="text-sm text-[var(--danger)]">Could not load this user&rsquo;s roles.</p>
      ) : assignedQuery.isLoading ? (
        <p className="text-sm text-[var(--fg-secondary)]">Loading roles…</p>
      ) : assigned.length === 0 ? (
        <p className="text-sm text-[var(--fg-secondary)]">No custom roles assigned yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {assigned.map((r) => (
            <span key={r.roleId} className="inline-flex items-center gap-1">
              <Badge tone="purple">{r.name}</Badge>
              <button
                type="button"
                className="iconbtn h-6 w-6"
                aria-label={`Revoke ${r.name} from ${userName}`}
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(r.roleId)}
              >
                <Icon name="close" size={12} ariaHidden />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <label className="sr-only" htmlFor={`assign-role-${userId}`}>
          Assign a role to {userName}
        </label>
        <select
          id={`assign-role-${userId}`}
          className="input max-w-[16rem]"
          value={pickerValue}
          onChange={(e) => setPickerValue(e.target.value)}
          disabled={allRoles.isLoading || assignable.length === 0}
        >
          <option value="">
            {assignable.length === 0 ? 'All roles assigned' : 'Select a role to assign…'}
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
          {assign.isPending ? 'Assigning…' : 'Assign'}
        </button>
      </div>
    </div>
  );
}
