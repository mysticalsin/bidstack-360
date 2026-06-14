// Admin-only Settings section: curate the global Top 10 accounts.
// Writes Company.topAccountRank via PUT /api/accounts/top-list; an empty list
// reverts /accounts/top to the auto pipeline-value leaderboard.
// Top (curated, trophy/amber) is deliberately distinct from Key accounts
// (regional strategic, star/purple) — see AccountTierBadges.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { TopAccountBadge } from '@/components/company/AccountTierBadges';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useCompanies } from '@/hooks/useCompanies';
import { useTopAccounts, useUpdateTopAccountList } from '@/hooks/useTopAccounts';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { TOP_ACCOUNTS_MAX } from '@bidstack/shared';

interface PickedCompany {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
}

export function TopAccountsSection() {
  const { t } = useTranslation('settings');
  const current = useTopAccounts({ limit: TOP_ACCOUNTS_MAX });
  const save = useUpdateTopAccountList();

  // null = untouched; the editor then mirrors the server's curated list so a
  // refetch can never clobber in-progress edits.
  const [list, setList] = useState<PickedCompany[] | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 250);

  const serverList = useMemo<PickedCompany[]>(
    () =>
      current.data?.source === 'curated'
        ? current.data.items.map((a) => ({
            id: a.id,
            name: a.name,
            domain: a.domain,
            industry: a.industry,
          }))
        : [],
    [current.data],
  );
  const picked = list ?? serverList;
  const dirty =
    list !== null &&
    (picked.length !== serverList.length || picked.some((c, i) => c.id !== serverList[i]?.id));

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= picked.length) return;
    const next = [...picked];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row!);
    setList(next);
  };

  const onSave = async () => {
    try {
      await save.mutateAsync(picked.map((c) => c.id));
      toast.success(
        picked.length > 0
          ? t('topAccounts.toastSaved', 'Saved — Top {{count}} curated', { count: picked.length })
          : t('topAccounts.toastCleared', 'Curation cleared — back to auto ranking'),
      );
    } catch {
      toast.error(t('topAccounts.toastSaveFailed', 'Save failed'));
    }
  };

  if (current.isLoading) return <LoadingSkeleton rows={4} />;
  if (current.isError) {
    return (
      <ErrorState
        title={t('topAccounts.errorTitle', "Couldn't load the current Top 10")}
        message={
          current.error instanceof Error
            ? current.error.message
            : t('topAccounts.errorMessage', 'Endpoint did not respond.')
        }
        action={
          <button type="button" className="btn btn-secondary" onClick={() => void current.refetch()}>
            {t('topAccounts.retry', 'Retry')}
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
              {t('topAccounts.heading', 'Global Top 10 accounts')}
            </h3>
            <TopAccountBadge />
          </div>
          <p className="mt-1 text-xs text-[var(--fg-secondary)]">
            {t(
              'topAccounts.subtitle',
              'Hand-pick and order up to {{count}} accounts for the Amaris global Top 10. This is separate from Key Accounts (regional strategic accounts flagged per company). Saving an empty list reverts the Top Accounts page to the automatic pipeline-value ranking.',
              { count: TOP_ACCOUNTS_MAX },
            )}
          </p>
        </div>

        {picked.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--fg-secondary)]">
            {t(
              'topAccounts.empty',
              'No curated accounts yet — search below to build the list. The Top Accounts page is currently auto-ranked by pipeline value.',
            )}
          </p>
        ) : (
          <ol
            aria-label={t('topAccounts.listAriaLabel', 'Curated top accounts, in rank order')}
            className="divide-y divide-[var(--border-subtle)]"
          >
            {picked.map((company, index) => (
              <li key={company.id} className="flex min-h-[44px] items-center gap-3 px-4 py-2">
                <span className="w-6 shrink-0 text-center text-sm font-bold text-[var(--fg-tertiary)]">
                  {index + 1}
                </span>
                <CompanyLogo name={company.name} domain={company.domain} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--fg-primary)]">
                    {company.name}
                  </div>
                  <div className="truncate text-xs text-[var(--fg-tertiary)]">
                    {company.industry ?? company.domain ?? '—'}
                  </div>
                </div>
                <RowButton
                  label={t('topAccounts.moveUpLabel', 'Move {{name}} up to rank {{rank}}', {
                    name: company.name,
                    rank: index,
                  })}
                  icon="caretup"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                />
                <RowButton
                  label={t('topAccounts.moveDownLabel', 'Move {{name}} down to rank {{rank}}', {
                    name: company.name,
                    rank: index + 2,
                  })}
                  icon="caret"
                  disabled={index === picked.length - 1}
                  onClick={() => move(index, 1)}
                />
                <RowButton
                  label={t('topAccounts.removeLabel', 'Remove {{name}} from the top accounts', {
                    name: company.name,
                  })}
                  icon="close"
                  onClick={() => setList(picked.filter((c) => c.id !== company.id))}
                />
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-3">
          <span className="text-xs text-[var(--fg-tertiary)]">
            {t('topAccounts.slotsUsed', '{{used}}/{{max}} slots used', {
              used: picked.length,
              max: TOP_ACCOUNTS_MAX,
            })}
          </span>
          <button
            type="button"
            className="btn btn-primary min-h-[44px]"
            disabled={!dirty || save.isPending}
            onClick={() => void onSave()}
          >
            {save.isPending
              ? t('topAccounts.saving', 'Saving…')
              : t('topAccounts.save', 'Save top accounts')}
          </button>
        </div>
      </Card>

      <CompanyPicker
        pickedIds={picked.map((c) => c.id)}
        full={picked.length >= TOP_ACCOUNTS_MAX}
        search={search}
        debouncedSearch={debouncedSearch}
        onSearchChange={setSearch}
        onAdd={(company) => setList([...picked, company])}
      />
    </div>
  );
}

// ─── RowButton ───────────────────────────────────────────────────────────────

function RowButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: 'caretup' | 'caret' | 'close';
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <Icon name={icon} size={15} ariaHidden />
    </button>
  );
}

// ─── CompanyPicker ───────────────────────────────────────────────────────────

function CompanyPicker({
  pickedIds,
  full,
  search,
  debouncedSearch,
  onSearchChange,
  onAdd,
}: {
  pickedIds: string[];
  full: boolean;
  search: string;
  debouncedSearch: string;
  onSearchChange: (value: string) => void;
  onAdd: (company: PickedCompany) => void;
}) {
  const { t } = useTranslation('settings');
  const results = useCompanies(debouncedSearch ? { search: debouncedSearch } : {});
  const candidates = (results.data?.items ?? [])
    .filter((c) => !pickedIds.includes(c.id))
    .slice(0, 8);

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('topAccounts.addHeading', 'Add accounts')}
        </h3>
      </div>
      <div className="p-4">
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
            ariaHidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('topAccounts.searchPlaceholder', 'Search companies to add…')}
            aria-label={t(
              'topAccounts.searchAriaLabel',
              'Search companies to add to the top accounts',
            )}
            disabled={full}
            className="input w-full pl-9"
          />
        </div>
        {full ? (
          <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
            {t(
              'topAccounts.slotsFull',
              'All {{count}} slots are used — remove an account to add another.',
              { count: TOP_ACCOUNTS_MAX },
            )}
          </p>
        ) : results.isLoading ? (
          <div className="mt-3 h-10 animate-pulse rounded-lg bg-[var(--surface-sunken)]" aria-hidden />
        ) : results.isError ? (
          <p role="alert" className="mt-3 text-xs text-[var(--danger)]">
            {t('topAccounts.searchFailed', 'Company search failed — try again.')}
          </p>
        ) : candidates.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--fg-tertiary)]">
            {debouncedSearch
              ? t('topAccounts.noMatches', 'No matching companies.')
              : t('topAccounts.typeToSearch', 'Type to search your portfolio.')}
          </p>
        ) : (
          <ul
            className="mt-3 divide-y divide-[var(--border-subtle)]"
            aria-label={t('topAccounts.resultsAriaLabel', 'Company search results')}
          >
            {candidates.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  onClick={() =>
                    onAdd({
                      id: company.id,
                      name: company.name,
                      domain: company.domain ?? null,
                      industry: company.industry ?? null,
                    })
                  }
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                >
                  <CompanyLogo name={company.name} domain={company.domain ?? null} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--fg-primary)]">
                    {company.name}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-[var(--brand-primary)]">
                    <Icon name="plus" size={13} ariaHidden />
                    {t('topAccounts.add', 'Add')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
