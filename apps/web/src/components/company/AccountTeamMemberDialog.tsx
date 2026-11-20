import { useState } from 'react';
import { isOverAllocated, type AccountTeamMember, type AccountTeamRole } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useAddTeamMember, useUpdateTeamMember, useUserAllocation } from '@/hooks/useAccountTeam';
import { useUsers } from '@/hooks/useUsers';

import { ROLE_LABELS, projectedAllocation } from './accountTeam';

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as AccountTeamRole[]).map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));

interface Props {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when adding. */
  member?: AccountTeamMember | null;
  excludeUserIds?: string[];
}

export function AccountTeamMemberDialog(props: Props) {
  const { open, onOpenChange, member } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={member ? 'Edit team member' : 'Add team member'}>
        {open ? <MemberForm key={member?.id ?? 'new'} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MemberForm({ companyId, open, onOpenChange, member, excludeUserIds = [] }: Props) {
  const editing = !!member;
  const [userId, setUserId] = useState(member?.userId ?? '');
  const [role, setRole] = useState<AccountTeamRole>(member?.role ?? 'other');
  const [pct, setPct] = useState(member?.allocationPct != null ? String(member.allocationPct) : '');
  const [startDate, setStartDate] = useState(member?.startDate ?? '');
  const [endDate, setEndDate] = useState(member?.endDate ?? '');

  const users = useUsers({ limit: 200, enabled: open && !editing });
  const allocation = useUserAllocation(open && userId ? userId : undefined);
  const add = useAddTeamMember(companyId);
  const update = useUpdateTeamMember(companyId);

  const pctNum = pct.trim() === '' ? null : Number(pct);
  const pctError =
    pctNum !== null && (!Number.isInteger(pctNum) || pctNum < 0 || pctNum > 100)
      ? 'Use a whole number from 0 to 100'
      : undefined;
  const dateError =
    startDate && endDate && endDate < startDate
      ? 'End date must be on or after the start date'
      : undefined;

  const currentTotal = allocation.data?.totalPct ?? 0;
  const projected = projectedAllocation(
    currentTotal,
    member?.allocationPct ?? null,
    pctError ? null : pctNum,
  );
  const personName =
    member?.userName ?? users.data?.find((u) => u.id === userId)?.name ?? 'This person';

  const userOptions = (users.data ?? [])
    .filter((u) => !excludeUserIds.includes(u.id))
    .map((u) => ({ value: u.id, label: u.name ?? u.email }));

  const pending = add.isPending || update.isPending;
  const canSave = !!userId && !pctError && !dateError && !pending;

  function save() {
    if (!canSave) return;
    const fields = {
      role,
      allocationPct: pctNum,
      startDate: startDate || null,
      endDate: endDate || null,
    };
    const done = { onSuccess: () => onOpenChange(false) };
    if (member) update.mutate({ memberId: member.id, patch: fields }, done);
    else add.mutate({ userId, ...fields }, done);
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {editing ? (
        <p className="text-sm font-medium text-[var(--fg-primary)]">{personName}</p>
      ) : (
        <Select
          label="Person"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          isLoading={users.isLoading}
          options={[{ value: '', label: 'Choose a person' }, ...userOptions]}
        />
      )}
      <Select
        label="Role"
        value={role}
        onChange={(e) => setRole(e.target.value as AccountTeamRole)}
        options={ROLE_OPTIONS}
      />
      <Input
        label="Allocation %"
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => setPct(e.target.value)}
        error={pctError}
        helper={
          userId && allocation.data
            ? `${projected}% across all accounts with this change`
            : undefined
        }
      />
      {userId && allocation.data && isOverAllocated(projected) ? (
        <p role="status" className="text-xs font-medium text-[var(--warning-fg)]">
          {personName} would be at {projected}% across accounts
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Start date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          label="End date"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          error={dateError}
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {editing ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
