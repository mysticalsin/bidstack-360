import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUsers, useUpdateUserRole, useOrgPresence } from '@/hooks/useUsers';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { Badge } from '@/components/ui/Badge';
import { OnlineDot } from '@/components/ui/Avatar';
import { formatDate } from '@/lib/format';
import { useIsAdmin } from '@/lib/auth';
import { UserRolesManager } from './UserRolesManager';

export function TeamSection() {
  const { t } = useTranslation('settings');
  const isAdmin = useIsAdmin();
  const users = useUsers();
  const updateRole = useUpdateUserRole();
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  // 6 columns when admin (status, name, email, role, joined, actions).
  const expandedColSpan = 6;
  // A5 — presence polling. Refetches every 30s (matches Redis TTL).
  // Uses select to project to Set<userId> so callers get O(1) lookups.
  // Presence errors never surface to the user — UI degrades to all-offline.
  const presence = useOrgPresence();

  return (
    <Card>
      <SectionHeader
        title={t('team.title', 'Team')}
        caption={t('team.caption', 'Members of your workspace. Admins can manage roles.')}
      />
      <div className="p-5">
        {users.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : !users.data || users.data.length === 0 ? (
          <p className="text-sm text-[var(--fg-secondary)]">
            {t('team.empty', 'No team members found.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--fg-tertiary)]">
                  {/* Status column is narrow — dot-only, no label text */}
                  <th
                    scope="col"
                    className="py-2 pr-2 font-medium w-6"
                    aria-label={t('team.col.status', 'Online status')}
                  />
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('team.col.name', 'Name')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('team.col.email', 'Email')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('team.col.role', 'Role')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('team.col.joined', 'Joined')}
                  </th>
                  {isAdmin ? (
                    <th scope="col" className="py-2 font-medium text-right">
                      {t('team.col.actions', 'Actions')}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => {
                  const isOnline = presence.data?.has(u.id) ?? false;
                  const expanded = isAdmin && expandedUserId === u.id;
                  return (
                    <Fragment key={u.id}>
                    <tr
                      className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-sunken)] transition-colors"
                    >
                      {/* A5 — online/offline dot; presence errors degrade to offline silently */}
                      <td className="py-2 pr-2 w-6">
                        <OnlineDot
                          online={isOnline}
                          label={t('team.presence.label', '{{name}} {{status}}', {
                            name: u.name ?? u.email,
                            status: isOnline
                              ? t('team.presence.online', 'online')
                              : t('team.presence.offline', 'offline'),
                          })}
                        />
                      </td>
                      <td className="py-2 pr-4 text-[var(--fg-primary)]">{u.name ?? '—'}</td>
                      <td className="py-2 pr-4 text-[var(--fg-secondary)]">{u.email}</td>
                      <td className="py-2 pr-4">
                        <Badge tone={u.role === 'admin' ? 'purple' : 'gray'}>{u.role}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-[var(--fg-secondary)]">
                        {formatDate(u.createdAt)}
                      </td>
                      {isAdmin ? (
                        <td className="py-2 text-right whitespace-nowrap">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-expanded={expandedUserId === u.id}
                            onClick={() =>
                              setExpandedUserId((cur) => (cur === u.id ? null : u.id))
                            }
                          >
                            {expandedUserId === u.id
                              ? t('team.action.hideRoles', 'Hide roles')
                              : t('team.action.manageRoles', 'Manage roles')}
                          </button>
                          {u.role === 'admin' ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={updateRole.isPending}
                              onClick={() => updateRole.mutate({ id: u.id, role: 'member' })}
                            >
                              {t('team.action.demote', 'Demote to member')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={updateRole.isPending}
                              onClick={() => updateRole.mutate({ id: u.id, role: 'admin' })}
                            >
                              {t('team.action.promote', 'Promote to admin')}
                            </button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={expandedColSpan} className="px-2 pb-3">
                          <UserRolesManager userId={u.id} userName={u.name ?? u.email} />
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
