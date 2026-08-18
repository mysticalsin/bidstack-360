// Memoized table row. Re-renders only when its own company data or selection
// state changes — avoids repainting the whole table on unrelated row toggles.
import { memo } from 'react';

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { CompanyLogo } from '@/components/company/CompanyLogo';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SpotlightTableRow } from '@/components/ui/SpotlightTable';
import { confirm as confirmDialog } from '@/components/ui/ConfirmDialog';
import type { Company } from '@bidstack/shared';

interface CompanyRowProps {
  company: Company;
  selected: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  // Delete is gated server-side behind companies:write AND the literal 'admin'
  // role — hide the row action for everyone else (matches CompaniesPage's
  // canWrite, sourced from useHasAdminPermission('companies:write')).
  canDelete: boolean;
  query: string;
}

export const CompanyRow = memo(function CompanyRow({
  company,
  selected,
  onToggle,
  onDelete,
  canDelete,
  query,
}: CompanyRowProps) {
  const { t } = useTranslation('crm');
  return (
    <SpotlightTableRow
      query={query}
      searchableText={`${company.name} ${company.legalName ?? ''} ${company.domain ?? ''} ${company.industry ?? ''}`}
      data-selected={selected}
    >
      <td>
        <label className="table-checkbox-hit">
          <span className="sr-only">
            {selected
              ? t('companyRow.deselectCompany', 'Deselect {{name}}', { name: company.name })
              : t('companyRow.selectCompany', 'Select {{name}}', { name: company.name })}
          </span>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(company.id)}
            className="cursor-pointer accent-[var(--brand-primary)]"
          />
        </label>
      </td>
      <td>
        <div className="flex min-w-[220px] items-center gap-3">
          <CompanyLogo name={company.name} companyId={company.id} domain={company.domain} size={36} />
          <div className="min-w-0">
            <Link
              to={`/companies/${company.id}`}
              className="block truncate font-semibold text-[var(--fg-primary)] hover:text-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
            >
              {company.name}
            </Link>
            {company.legalName && company.legalName !== company.name && (
              <div className="truncate text-xs text-[var(--fg-tertiary)]">{company.legalName}</div>
            )}
          </div>
        </div>
      </td>
      <td className="text-[var(--fg-secondary)]">
        {company.domain ? (
          <a
            href={`https://${company.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
          >
            <Icon name="globe" size={13} ariaHidden />
            {company.domain}
          </a>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">{company.industry ?? '—'}</td>
      <td className="tabular-nums text-[var(--fg-secondary)]">
        {company.employeeCount?.toLocaleString() ?? '—'}
      </td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">{company.countryCode ?? '—'}</td>
      <td className="text-right">
        <div className="inline-flex items-center gap-1">
          <Link
            to={`/companies/${company.id}`}
            className="btn btn-ghost btn-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
          >
            {t('companyRow.view', 'View')}
          </Link>
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--danger)] hover:text-[var(--danger)]"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: t('companyRow.deleteConfirmTitle', 'Delete {{name}}?', {
                    name: company.name,
                  }),
                  description: t(
                    'companyRow.deleteConfirmDescription',
                    'This action cannot be undone.',
                  ),
                  confirmLabel: t('companyRow.deleteConfirmLabel', 'Delete'),
                  destructive: true,
                });
                if (ok) onDelete(company.id);
              }}
            >
              {t('companyRow.delete', 'Delete')}
            </Button>
          )}
        </div>
      </td>
    </SpotlightTableRow>
  );
});
