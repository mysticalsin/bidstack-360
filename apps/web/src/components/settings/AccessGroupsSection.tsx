import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  useAddGroupMember,
  useCreateUserGroup,
  useDeleteUserGroup,
  useRemoveGroupMember,
  useUpdateUserGroup,
  useUserGroup,
  useUserGroups,
} from '@/hooks/useUserGroups';
import { useUsers } from '@/hooks/useUsers';
import type { UserGroup } from '@bidstack/shared';

/**
 * M7 — Settings → Access groups (admin).
 * Groups mirror the source systems' (ABC, Opportunity Management) group
 * access. Members of a group only see opportunities, account cockpits,
 * account notes, and files in the group's countries (plus deals they own).
 * No groups / a "sees everything" group
 * = unrestricted. Admin-managed until the source-system sync lands.
 */
export function AccessGroupsSection() {
  const { t } = useTranslation('settings');
  const { data: groups, isLoading, isError, refetch } = useUserGroups();
  const create = useCreateUserGroup();
  const del = useDeleteUserGroup();

  const [draftName, setDraftName] = useState('');
  const [draftCountries, setDraftCountries] = useState<string[]>([]);
  const [draftScopeAll, setDraftScopeAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    try {
      await create.mutateAsync({ name, scopeCountries: draftCountries, scopeAll: draftScopeAll });
      setDraftName('');
      setDraftCountries([]);
      setDraftScopeAll(false);
      toast.success(t('accessGroups.toastCreated', 'Access group created'));
    } catch {
      toast.error(
        t(
          'accessGroups.toastCreateError',
          'Could not create the group — does the name already exist?',
        ),
      );
    }
  };

  const handleDelete = async (g: UserGroup) => {
    const ok = confirm(
      t(
        'accessGroups.confirmDelete',
        'Delete "{{name}}"? Its {{count}} members will fall back to their remaining groups (or unrestricted access if they have none).',
        { name: g.name, count: g.memberCount },
      ),
    );
    if (!ok) return;
    try {
      await del.mutateAsync(g.id);
      if (expandedId === g.id) setExpandedId(null);
      toast.success(t('accessGroups.toastDeleted', 'Access group deleted'));
    } catch {
      toast.error(t('accessGroups.toastDeleteError', 'Delete failed'));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--fg-secondary)]">
        {t(
          'accessGroups.intro',
          "Members of a group only see opportunities, account cockpits, notes, and files in the group's countries, plus deals they own. Users in no group see everything - scoping starts when you assign them. Groups will sync from ABC / Opportunity Management once those connectors exist.",
        )}
      </p>

      <Card>
        <div className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--fg-primary)]">
            {t('accessGroups.createHeading', 'Create access group')}
          </h3>
          <div className="space-y-3">
            <input
              type="text"
              maxLength={100}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={t('accessGroups.namePlaceholder', 'e.g. France bid team')}
              aria-label={t('accessGroups.nameLabel', 'Group name')}
              className="w-full max-w-md rounded-md border border-[var(--border-default)] bg-[var(--surface-input)] px-2.5 py-2 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
            />
            {!draftScopeAll && (
              <CountryChipInput value={draftCountries} onChange={setDraftCountries} />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-[var(--fg-secondary)]">
                <input
                  type="checkbox"
                  checked={draftScopeAll}
                  onChange={(e) => setDraftScopeAll(e.target.checked)}
                  className="h-4 w-4 accent-[var(--brand-primary)]"
                />
                {t('accessGroups.scopeAllLabel', 'Sees everything (no country restriction)')}
              </label>
              <Button
                onClick={() => void handleCreate()}
                disabled={!draftName.trim() || create.isPending}
              >
                {create.isPending
                  ? t('accessGroups.creating', 'Creating…')
                  : t('accessGroups.createButton', 'Create group')}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="border-b border-[var(--border-subtle)] px-4 py-2">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('accessGroups.listHeading', 'Groups')}{' '}
            <span className="font-normal text-[var(--fg-tertiary)]">({groups?.length ?? 0})</span>
          </h3>
        </div>
        {isLoading ? (
          <div className="p-4">
            <LoadingSkeleton rows={3} />
          </div>
        ) : isError ? (
          <div className="p-6">
            <ErrorState
              title={t('accessGroups.errorTitle', 'Could not load access groups')}
              message={t('accessGroups.errorMessage', 'Check your connection and try again.')}
              action={
                <Button variant="secondary" onClick={() => void refetch()}>
                  {t('accessGroups.retry', 'Retry')}
                </Button>
              }
            />
          </div>
        ) : !groups || groups.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={t('accessGroups.emptyTitle', 'No access groups yet')}
              message={t(
                'accessGroups.emptyMessage',
                'Everyone currently sees all opportunities, account cockpits, notes, and files. Create a group above to start scoping visibility by country.',
              )}
            />
          </div>
        ) : (
          <ul
            className="divide-y divide-[var(--border-subtle)]"
            aria-label={t('accessGroups.listAriaLabel', 'Access groups')}
          >
            {groups.map((g) => (
              <li key={g.id}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-[160px] flex-1">
                    <span className="text-sm font-medium text-[var(--fg-primary)]">{g.name}</span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {g.scopeAll ? (
                        <span className="rounded-full bg-[var(--success-tint)] px-2 py-0.5 text-[11px] font-medium text-[var(--success)]">
                          {t('accessGroups.badgeSeesEverything', 'Sees everything')}
                        </span>
                      ) : g.scopeCountries.length === 0 ? (
                        <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] text-[var(--fg-tertiary)]">
                          {t('accessGroups.badgeOwnRecordsOnly', 'Own records only')}
                        </span>
                      ) : (
                        g.scopeCountries.map((c) => (
                          <span
                            key={c}
                            className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--fg-secondary)]"
                          >
                            {c}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <span className="min-w-[80px] text-right text-xs text-[var(--fg-tertiary)]">
                    {t('accessGroups.memberCount', '{{count}} members', { count: g.memberCount })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-expanded={expandedId === g.id}
                    onClick={() => setExpandedId(expandedId === g.id ? null : g.id)}
                  >
                    <Icon name="pencil" size={14} ariaHidden /> {t('accessGroups.edit', 'Edit')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void handleDelete(g)}>
                    {t('accessGroups.delete', 'Delete')}
                  </Button>
                </div>
                {expandedId === g.id && <GroupEditor group={g} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Expanded editor: scope countries + member management for one group. */
function GroupEditor({ group }: { group: UserGroup }) {
  const { t } = useTranslation('settings');
  const detail = useUserGroup(group.id);
  const update = useUpdateUserGroup();
  const addMember = useAddGroupMember();
  const removeMember = useRemoveGroupMember();
  const { data: users } = useUsers();
  const [pickedUserId, setPickedUserId] = useState('');

  const members = detail.data?.members ?? [];
  const memberIds = new Set(members.map((m) => m.userId));
  const candidates = (users ?? []).filter((u) => !memberIds.has(u.id));

  const handleCountries = async (countries: string[]) => {
    try {
      await update.mutateAsync({ id: group.id, patch: { scopeCountries: countries } });
    } catch {
      toast.error(t('accessGroups.toastCountriesError', 'Could not update countries'));
    }
  };

  const handleScopeAll = async (scopeAll: boolean) => {
    try {
      await update.mutateAsync({ id: group.id, patch: { scopeAll } });
    } catch {
      toast.error(t('accessGroups.toastUpdateError', 'Could not update the group'));
    }
  };

  const handleAdd = async () => {
    if (!pickedUserId) return;
    try {
      await addMember.mutateAsync({ groupId: group.id, userId: pickedUserId });
      setPickedUserId('');
      toast.success(t('accessGroups.toastMemberAdded', 'Member added'));
    } catch {
      toast.error(t('accessGroups.toastMemberAddError', 'Could not add member'));
    }
  };

  return (
    <div className="space-y-4 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-4">
      <div className="space-y-2">
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-[var(--fg-secondary)]">
          <input
            type="checkbox"
            checked={group.scopeAll}
            onChange={(e) => void handleScopeAll(e.target.checked)}
            className="h-4 w-4 accent-[var(--brand-primary)]"
          />
          {t('accessGroups.scopeAllLabel', 'Sees everything (no country restriction)')}
        </label>
        {!group.scopeAll && (
          <CountryChipInput value={group.scopeCountries} onChange={(v) => void handleCountries(v)} />
        )}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          {t('accessGroups.membersHeading', 'Members')}
        </h4>
        {detail.isLoading ? (
          <LoadingSkeleton rows={2} />
        ) : members.length === 0 ? (
          <p className="text-sm text-[var(--fg-tertiary)]">
            {t('accessGroups.noMembers', 'No members yet.')}
          </p>
        ) : (
          <ul
            className="space-y-1"
            aria-label={t('accessGroups.membersListAriaLabel', 'Members of {{name}}', {
              name: group.name,
            })}
          >
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate text-[var(--fg-primary)]">
                  {m.name ?? m.email}
                  {m.name && (
                    <span className="ml-1.5 text-xs text-[var(--fg-tertiary)]">{m.email}</span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('accessGroups.removeMemberAriaLabel', 'Remove {{member}} from {{group}}', {
                    member: m.name ?? m.email,
                    group: group.name,
                  })}
                  onClick={() =>
                    void removeMember
                      .mutateAsync({ groupId: group.id, userId: m.userId })
                      .catch(() =>
                        toast.error(
                          t('accessGroups.toastMemberRemoveError', 'Could not remove member'),
                        ),
                      )
                  }
                >
                  {t('accessGroups.remove', 'Remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={pickedUserId}
            onChange={(e) => setPickedUserId(e.target.value)}
            aria-label={t('accessGroups.addMemberLabel', 'Add a member')}
            className="h-9 min-w-[220px] rounded-md border border-[var(--border-default)] bg-[var(--surface-input)] px-2 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            <option value="">{t('accessGroups.addMemberPlaceholder', 'Add a member…')}</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={() => void handleAdd()}
            disabled={!pickedUserId || addMember.isPending}
          >
            {t('accessGroups.add', 'Add')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** ISO-2 country chip input — type a code, Enter/comma to add. */
function CountryChipInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation('settings');
  const [draft, setDraft] = useState('');

  const commit = () => {
    const code = draft.trim().toUpperCase();
    setDraft('');
    if (!/^[A-Z]{2}$/.test(code)) {
      if (code)
        toast.error(
          t('accessGroups.countryCodeError', 'Country codes are 2 letters (ISO-2), e.g. FR'),
        );
      return;
    }
    if (!value.includes(code)) onChange([...value, code]);
  };

  return (
    <div
      className={cn(
        'flex min-h-[44px] w-full max-w-md flex-wrap items-center gap-1.5 rounded-md border',
        'border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5',
      )}
    >
      {value.map((c) => (
        <span
          key={c}
          className="flex items-center gap-1 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs font-medium text-[var(--fg-secondary)]"
        >
          {c}
          <button
            type="button"
            aria-label={t('accessGroups.removeCountryAriaLabel', 'Remove {{code}}', { code: c })}
            onClick={() => onChange(value.filter((v) => v !== c))}
            className="rounded-full p-0.5 hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            <Icon name="x" size={12} ariaHidden />
          </button>
        </span>
      ))}
      <input
        type="text"
        maxLength={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={
          value.length === 0
            ? t('accessGroups.countryPlaceholder', 'Countries (ISO-2): FR, DE…')
            : t('accessGroups.countryPlaceholderShort', 'Add…')
        }
        aria-label={t('accessGroups.addCountryAriaLabel', 'Add country code')}
        className="min-w-[90px] flex-1 bg-transparent py-1 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus-visible:outline-none"
      />
    </div>
  );
}
