import { Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { isOverAllocated, type AccountTeamMember } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useAccountTeam, useRemoveTeamMember } from '@/hooks/useAccountTeam';
import { useHasPermission } from '@/hooks/useCapabilities';

import { ROLE_LABELS } from './accountTeam';
import { AccountTeamMemberDialog } from './AccountTeamMemberDialog';

function initials(name: string | null, email: string | null): string {
  const src = (name ?? email ?? '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function day(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dateRange(m: AccountTeamMember): string | null {
  if (m.startDate && m.endDate) return `${day(m.startDate)} to ${day(m.endDate)}`;
  if (m.startDate) return `from ${day(m.startDate)}`;
  if (m.endDate) return `until ${day(m.endDate)}`;
  return null;
}

function Avatar({ name, email }: { name: string | null; email: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-xs font-semibold text-[var(--fg-secondary)]"
    >
      {initials(name, email)}
    </span>
  );
}

export function AllocationBar({ pct, total }: { pct: number; total: number }) {
  const over = isOverAllocated(total);
  return (
    <span className="flex items-center gap-2">
      <span className="w-10 text-right text-xs tabular-nums text-[var(--fg-primary)]">{pct}%</span>
      <span
        role="meter"
        aria-label={over ? `Allocation ${pct}%, ${total}% across accounts` : `Allocation ${pct}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="relative h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
      >
        <span
          data-over={over || undefined}
          className={`absolute inset-y-0 left-0 rounded-full ${over ? 'bg-[var(--danger)]' : 'bg-[var(--brand-primary)]'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </span>
    </span>
  );
}

export function AccountTeamCard({ companyId }: { companyId: string }) {
  const team = useAccountTeam(companyId);
  const canWrite = useHasPermission('companies:write');
  const remove = useRemoveTeamMember(companyId);
  const [dialog, setDialog] = useState<{ open: boolean; member: AccountTeamMember | null }>({
    open: false,
    member: null,
  });

  const owner = team.data?.keyAccountOwner ?? null;
  const members = team.data?.members ?? [];

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] p-4">
        <div className="flex items-center gap-2">
          <Users aria-hidden="true" size={16} className="text-[var(--fg-tertiary)]" />
          <h2 className="text-base font-semibold text-[var(--fg-primary)]">Account team</h2>
        </div>
        {canWrite ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDialog({ open: true, member: null })}
          >
            <UserPlus aria-hidden="true" size={14} /> Add member
          </Button>
        ) : null}
      </div>
      <div className="p-4">
        {team.isLoading ? (
          <LoadingSkeleton rows={2} />
        ) : team.isError ? (
          <p className="text-sm text-[var(--fg-secondary)]">
            The account team could not be loaded.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {owner ? (
              <li className="flex items-center gap-3 py-2 first:pt-0">
                <Avatar name={owner.name} email={owner.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--fg-primary)]">
                    {owner.name ?? owner.email}
                  </p>
                  <p className="text-xs text-[var(--fg-secondary)]">Account lead</p>
                </div>
                <span className="rounded-md bg-[var(--surface-sunken)] px-2 py-0.5 text-xs text-[var(--fg-secondary)]">
                  Owner of record
                </span>
              </li>
            ) : null}
            {members.map((m) => {
              const range = dateRange(m);
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <Avatar name={m.userName} email={m.userEmail} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--fg-primary)]">
                      {m.userName ?? m.userEmail}
                    </p>
                    <p className="text-xs text-[var(--fg-secondary)]">
                      {ROLE_LABELS[m.role]}
                      {range ? `, ${range}` : ''}
                    </p>
                  </div>
                  {m.allocationPct != null ? (
                    <AllocationBar pct={m.allocationPct} total={m.totalAllocationPct} />
                  ) : null}
                  {canWrite ? (
                    <span className="flex items-center">
                      <button
                        type="button"
                        aria-label={`Edit ${m.userName ?? 'member'}`}
                        onClick={() => setDialog({ open: true, member: m })}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                      >
                        <Pencil aria-hidden="true" size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${m.userName ?? 'member'}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(m.id)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
            {!owner && members.length === 0 ? (
              <li className="text-sm text-[var(--fg-secondary)]">No one on the team yet</li>
            ) : null}
          </ul>
        )}
      </div>
      {canWrite ? (
        <AccountTeamMemberDialog
          companyId={companyId}
          open={dialog.open}
          member={dialog.member}
          excludeUserIds={members.map((m) => m.userId)}
          onOpenChange={(open) => setDialog((d) => ({ open, member: open ? d.member : null }))}
        />
      ) : null}
    </Card>
  );
}
