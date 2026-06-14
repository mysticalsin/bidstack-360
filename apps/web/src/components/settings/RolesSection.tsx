import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useRoles,
  usePermissions,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
} from '@/hooks/useRoles';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton, EmptyState } from '@/components/ui/StateMessages';
import { confirm } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';

export function RolesSection() {
  const { t } = useTranslation('settings');
  const isAdmin = useIsAdmin();
  const roles = useRoles();
  const permissions = usePermissions();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();

  const [showNew, setShowNew] = useState(false);
  const [editRole, setEditRole] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());

  const allPermissions = permissions.data ?? [];
  const allRoles = roles.data ?? [];

  const resetForm = () => {
    setName('');
    setDescription('');
    setSelectedPerms(new Set());
    setShowNew(false);
    setEditRole(null);
  };

  const startEdit = (role: (typeof allRoles)[number]) => {
    setEditRole(role.id);
    setName(role.name);
    setDescription(role.description ?? '');
    setSelectedPerms(new Set(role.permissions.map((p) => p.id)));
    setShowNew(true);
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error(t('roles.toastNameRequired', 'Role name is required'));
      return;
    }
    try {
      if (editRole) {
        await updateRole.mutateAsync({
          id: editRole,
          name: name.trim(),
          description: description.trim() || undefined,
          permissionIds: Array.from(selectedPerms),
        });
        toast.success(t('roles.toastUpdated', 'Role updated'));
      } else {
        await createRole.mutateAsync({
          name: name.trim(),
          description: description.trim() || undefined,
          permissionIds: Array.from(selectedPerms),
        });
        toast.success(t('roles.toastCreated', 'Role created'));
      }
      resetForm();
    } catch (_err) {
      toast.error(
        editRole
          ? t('roles.toastUpdateFailed', 'Failed to update role')
          : t('roles.toastCreateFailed', 'Failed to create role'),
      );
    }
  };

  const onDelete = async (role: (typeof allRoles)[number]) => {
    const ok = await confirm({
      title: t('roles.deleteConfirmTitle', 'Delete role "{{name}}"?', { name: role.name }),
      description: t(
        'roles.deleteConfirmDescription',
        'This will remove the role from all assigned users.',
      ),
      confirmLabel: t('roles.deleteConfirmLabel', 'Delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteRole.mutateAsync(role.id);
      toast.success(t('roles.toastDeleted', 'Role deleted'));
    } catch {
      toast.error(t('roles.toastDeleteFailed', 'Failed to delete role'));
    }
  };

  const togglePerm = (id: string) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <SectionHeader
        title={t('roles.sectionTitle', 'Roles & Permissions')}
        caption={t('roles.sectionCaption', 'Manage workspace roles and what each role can do.')}
      />
      <div className="p-5 space-y-4">
        {roles.isLoading || permissions.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : (
          <>
            {isAdmin && !showNew && (
              <Button size="sm" onClick={() => setShowNew(true)}>
                {t('roles.newRoleButton', '+ New role')}
              </Button>
            )}

            {showNew && (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
                  {editRole
                    ? t('roles.formTitleEdit', 'Edit role')
                    : t('roles.formTitleCreate', 'Create role')}
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
                      {t('roles.fieldName', 'Name')}
                    </label>
                    <input
                      className="input w-full"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('roles.namePlaceholder', 'e.g. Sales Manager')}
                      maxLength={100}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
                      {t('roles.fieldDescription', 'Description')}
                    </label>
                    <input
                      className="input w-full"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t('roles.descriptionPlaceholder', 'Optional description')}
                      maxLength={500}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-2">
                      {t('roles.fieldPermissions', 'Permissions')}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                      {allPermissions.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-sm cursor-pointer hover:bg-[var(--surface-hover)]"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPerms.has(p.id)}
                            onChange={() => togglePerm(p.id)}
                            className="h-4 w-4 accent-[var(--brand-primary)]"
                          />
                          <span className="text-[var(--fg-primary)]">{p.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={submit}
                    disabled={createRole.isPending || updateRole.isPending}
                  >
                    {editRole
                      ? t('roles.saveChangesButton', 'Save changes')
                      : t('roles.createRoleButton', 'Create role')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={resetForm}>
                    {t('roles.cancelButton', 'Cancel')}
                  </Button>
                </div>
              </div>
            )}

            {allRoles.length === 0 ? (
              <EmptyState
                title={t('roles.emptyTitle', 'No roles yet')}
                message={t('roles.emptyMessage', 'Create your first custom role.')}
              />
            ) : (
              <div className="space-y-3">
                {allRoles.map((role) => (
                  <div
                    key={role.id}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--fg-primary)]">{role.name}</span>
                          {role.isSystem && (
                            <Badge tone="blue">{t('roles.systemBadge', 'System')}</Badge>
                          )}
                        </div>
                        {role.description && (
                          <p className="mt-1 text-xs text-[var(--fg-secondary)]">
                            {role.description}
                          </p>
                        )}
                      </div>
                      {isAdmin && !role.isSystem && (
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="ghost" onClick={() => startEdit(role)}>
                            {t('roles.editButton', 'Edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-[var(--danger)]"
                            onClick={() => onDelete(role)}
                          >
                            {t('roles.deleteButton', 'Delete')}
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {role.permissions.length === 0 ? (
                        <span className="text-xs text-[var(--fg-tertiary)]">
                          {t('roles.noPermissions', 'No permissions')}
                        </span>
                      ) : (
                        role.permissions.map((p) => (
                          <Badge key={p.id} tone="gray">
                            {p.name}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
