import { useUsers, useUpdateUserRole, useOrgPresence } from '@/hooks/useUsers';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { Badge } from '@/components/ui/Badge';
import { OnlineDot } from '@/components/ui/Avatar';
import { formatDate } from '@/lib/format';
import { useIsAdmin } from '@/lib/auth';

export function TeamSection() {
  const isAdmin = useIsAdmin();
  const users = useUsers();
  const updateRole = useUpdateUserRole();
  // A5 — presence polling. Refetches every 30s (matches Redis TTL).
  // Uses select to project to Set<userId> so callers get O(1) lookups.
  // Presence errors never surface to the user — UI degrades to all-offline.
  const presence = useOrgPresence();

  return (
    <Card>
      <SectionHeader title="Team" caption="Members of your workspace. Admins can manage roles." />
      <div className="p-5">
        {users.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : !users.data || users.data.length === 0 ? (
          <p className="text-sm text-[var(--fg-secondary)]">No team members found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--fg-tertiary)]">
                  {/* Status column is narrow — dot-only, no label text */}
                  <th className="py-2 pr-2 font-medium w-6" aria-label="Online status" />
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Joined</th>
                  {isAdmin ? <th className="py-2 font-medium text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => {
                  const isOnline = presence.data?.has(u.id) ?? false;
                  return (
                  <tr
                    key={u.id}
                    className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-sunken)] transition-colors"
                  >
                    {/* A5 — online/offline dot; presence errors degrade to offline silently */}
                    <td className="py-2 pr-2 w-6">
                      <OnlineDot
                        online={isOnline}
                        label={`${u.name ?? u.email} ${isOnline ? 'online' : 'offline'}`}
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
                      <td className="py-2 text-right">
                        {u.role === 'admin' ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={updateRole.isPending}
                            onClick={() => updateRole.mutate({ id: u.id, role: 'member' })}
                          >
                            Demote to member
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={updateRole.isPending}
                            onClick={() => updateRole.mutate({ id: u.id, role: 'admin' })}
                          >
                            Promote to admin
                          </button>
                        )}
                      </td>
                    ) : null}
                  </tr>
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
