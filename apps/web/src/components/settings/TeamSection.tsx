import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUsersPage, useUpdateUserRole, useOrgPresence } from '@/hooks/useUsers';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { CursorPager } from '@/components/ui/CursorPager';
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
  // Cursor-paginated so a 100k-employee tenant can page through every member;
  // the prior flat useUsers() capped the Team list at the first 100.
  const pager = useCursorPagination('team');
  const users = useUsersPage({ limit: 50, ...(pager.cursor ? { cursor: pager.cursor } : {}) });
  const updateRole = useUpdateUserRole();
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  // 6 columns when admin (status, name, email, role, joined, actions).
  const expandedColSpan = 6;
  // Presence polls every 30s (matches the Redis TTL) and projects to a
  // Set<userId>. A snapshot that has not arrived is not an offline team.
  const presence = useOrgPresence();
  const rosterFailed = users.isError;
  const rosterUnread =
    !rosterFailed && (users.isPending || users.isLoading || users.data === undefined);
  const presenceFailed = presence.isError;
  const presenceUnread = !presenceFailed && (presence.isPending || presence.data === undefined);
  const knownPresence = !presenceFailed && !presenceUnread ? presence.data : undefined;

  return (
    <Card>
      <SectionHeader
        title={t('team.title', 'Team')}
        caption={t('team.caption', 'Members of your workspace. Admins can manage roles.')}
      />
      <div className="p-5">
        {rosterFailed ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {t('team.failed', 'Could not load the team. The roster has not arrived.')}
          </p>
        ) : rosterUnread || !users.data ? (
          <>
            <p role="status" className="text-sm text-[var(--fg-secondary)]">
              {t('team.checking', 'Checking the team. The roster has not arrived.')}
            </p>
            <LoadingSkeleton rows={3} />
          </>
        ) : users.data.items.length === 0 ? (
          <p className="text-sm text-[var(--fg-secondary)]">
            {t('team.empty', 'No team members found.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            {presenceFailed ? (
              <p role="alert" className="mb-3 text-sm text-[var(--danger)]">
                {t(
                  'team.presence.failed',
                  'Could not load presence. Status has not arrived.',
                )}
              </p>
            ) : presenceUnread || !knownPresence ? (
              <p role="status" className="mb-3 text-sm text-[var(--fg-secondary)]">
                {t('team.presence.unread', 'Checking presence. Status has not arrived.')}
              </p>
            ) : null}
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
                {users.data.items.map((u) => {
                  const isOnline = knownPresence?.has(u.id) ?? false;
                  const expanded = isAdmin && expandedUserId === u.id;
                  return (
                    <Fragment key={u.id}>
                    <tr
                      className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-sunken)] transition-colors"
                    >
                      <td className="py-2 pr-2 w-6">
                        {knownPresence ? (
                          <OnlineDot
                            online={isOnline}
                            label={t('team.presence.label', '{{name}} {{status}}', {
                              name: u.name ?? u.email,
                              status: isOnline
                                ? t('team.presence.online', 'online')
                                : t('team.presence.offline', 'offline'),
                            })}
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--border-default)]"
                          />
                        )}
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
            <CursorPager
              currentPage={pager.page}
              hasNext={Boolean(users.data.nextCursor)}
              hasPrevious={pager.hasPrevious}
              isLoading={users.isLoading}
              itemCount={users.data.items.length}
              label={t('team.pager.label', 'members')}
              onNext={() => pager.goNext(users.data?.nextCursor)}
              onPrevious={pager.goPrevious}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
