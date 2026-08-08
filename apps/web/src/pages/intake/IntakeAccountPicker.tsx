/**
 * IntakeAccountPicker — inline account search-select for the Intake workflow.
 *
 * WHY this exists: the '/intake' rail item carries no account id, and until
 * now the only way to attach one was hand-editing the URL query string. This
 * gives ReceiveStep's "no account selected" state a real way forward.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanyLogo } from '@/components/company/CompanyLogo';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { Input } from '@/components/ui/Input';
import { useCompanies } from '@/hooks/useCompanies';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

interface IntakeAccountPickerProps {
  onSelect: (id: string) => void;
}

export function IntakeAccountPicker({ onSelect }: IntakeAccountPickerProps) {
  const { t } = useTranslation('crm');
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q, 250);
  const companies = useCompanies({ search: debounced.trim() || undefined });
  const items = companies.data?.items ?? [];

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('crm.receiveStep.pickAccountTitle', 'Choose an account to begin')}
        </h3>
        <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">
          {t('crm.receiveStep.pickAccountHint', 'Search for the account you want to run intake for.')}
        </p>
      </div>
      <Input
        type="search"
        placeholder={t('crm.receiveStep.pickAccountPlaceholder', 'Search accounts…')}
        aria-label={t('crm.receiveStep.pickAccountPlaceholder', 'Search accounts…')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {companies.isError ? (
        <ErrorState
          title={t('crm.receiveStep.pickAccountErrorTitle', 'Could not load accounts')}
          message={companies.error instanceof Error ? companies.error.message : undefined}
        />
      ) : companies.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <ul
          className="max-h-64 space-y-1 overflow-y-auto"
          role="listbox"
          aria-label={t('crm.receiveStep.pickAccountListLabel', 'Accounts')}
        >
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => onSelect(c.id)}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
              >
                <CompanyLogo name={c.name} companyId={c.id} domain={c.domain} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--fg-primary)]">{c.name}</span>
                {c.industry && <span className="shrink-0 text-xs text-[var(--fg-tertiary)]">{c.industry}</span>}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-[var(--fg-tertiary)]">
              {t('crm.receiveStep.pickAccountEmpty', 'No matching accounts.')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
