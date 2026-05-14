import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';

import { useCompanies, useCreateCompany, useDeleteCompany } from '@/hooks/useCompanies';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { BulkActionBar } from '@/components/ui/BulkActionBar';
import { confirm as confirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import type { Company } from '@bidstack/shared';

export function CompaniesPage() {
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);

  const filter = useMemo(() => {
    const search = params.get('search') ?? undefined;
    return { search, limit: 50 };
  }, [params]);

  const companies = useCompanies(filter);
  const createCompany = useCreateCompany();
  const deleteCompany = useDeleteCompany();

  const items = companies.data?.items ?? [];
  const bulk = useBulkSelection(items);

  const exportSelected = () => {
    if (bulk.selectedItems.length === 0) {
      toast.info('Nothing to export');
      return;
    }
    const csv = rowsToCsv(
      bulk.selectedItems.map((c) => ({
        name: c.name,
        legalName: c.legalName ?? '',
        domain: c.domain ?? '',
        industry: c.industry ?? '',
        employeeCount: c.employeeCount?.toString() ?? '',
        countryCode: c.countryCode ?? '',
      })),
      [
        { key: 'name', label: 'Name' },
        { key: 'legalName', label: 'Legal Name' },
        { key: 'domain', label: 'Domain' },
        { key: 'industry', label: 'Industry' },
        { key: 'employeeCount', label: 'Employees' },
        { key: 'countryCode', label: 'Country' },
      ],
    );
    downloadCsv(`bidstack-companies-${new Date().toISOString().slice(0, 10)}`, csv);
    toast.success(
      `Exported ${bulk.selectedItems.length} compan${bulk.selectedItems.length === 1 ? 'y' : 'ies'}`,
    );
  };

  const bulkDelete = async () => {
    if (bulk.selectedItems.length === 0) return;
    const ok = await confirmDialog({
      title: `Delete ${bulk.selectedItems.length} compan${bulk.selectedItems.length === 1 ? 'y' : 'ies'}?`,
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    let failed = 0;
    await Promise.all(
      bulk.selectedItems.map((c) =>
        deleteCompany.mutateAsync(c.id).catch(() => {
          failed += 1;
        }),
      ),
    );
    bulk.clear();
    if (failed === 0) {
      toast.success(
        `Deleted ${bulk.selectedItems.length} compan${bulk.selectedItems.length === 1 ? 'y' : 'ies'}`,
      );
    } else {
      toast.error(`${failed} deletion${failed === 1 ? '' : 's'} failed`);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Companies</h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Manage your customer and prospect companies.
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Icon name="plus" size={14} />
          New company
        </Button>
      </header>

      <Card>
        <div className="card-body flex flex-wrap gap-3">
          <label htmlFor="company-search" className="account-filter">
            <Icon name="search" size={14} ariaHidden />
            <input
              id="company-search"
              type="search"
              placeholder="Search by name or domain…"
              aria-label="Search companies"
              value={filter.search ?? ''}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('search', e.target.value);
                else next.delete('search');
                setParams(next, { replace: true });
              }}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
            />
          </label>
        </div>
      </Card>

      {showNew && (
        <NewCompanyDialog
          onClose={() => setShowNew(false)}
          onCreate={async (body) => {
            await createCompany.mutateAsync({
              name: body.name,
              legalName: null,
              domain: body.domain ?? null,
              industry: body.industry ?? null,
              employeeCount: null,
              countryCode: body.countryCode ?? null,
              address: null,
              billingEmail: null,
              taxId: null,
              logoUrl: null,
              website: null,
            });
            setShowNew(false);
          }}
          isPending={createCompany.isPending}
        />
      )}

      <BulkActionBar
        count={bulk.count}
        onExport={exportSelected}
        onDelete={bulkDelete}
        onClear={bulk.clear}
        isDeleting={deleteCompany.isPending}
      />

      {companies.isLoading ? (
        <LoadingSkeleton rows={8} />
      ) : !companies.data || companies.data.items.length === 0 ? (
        <EmptyState title="No companies found" />
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm [&_tr[data-selected=true]]:bg-[var(--brand-primary-tint)]/60">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--fg-tertiary)]">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={bulk.allSelected ? 'Deselect all' : 'Select all'}
                      checked={bulk.allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = bulk.someSelected;
                      }}
                      onChange={() => bulk.toggleAll(items)}
                      className="h-4 w-4 cursor-pointer accent-[var(--brand-primary)]"
                    />
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Domain
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Industry
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Employees
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Country
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {companies.data.items.map((c) => (
                  <CompanyRow
                    key={c.id}
                    company={c}
                    selected={bulk.isSelected(c.id)}
                    onToggle={() => bulk.toggleOne(c.id)}
                    onDelete={(id) => deleteCompany.mutate(id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CompanyRow({
  company,
  selected,
  onToggle,
  onDelete,
}: {
  company: Company;
  selected: boolean;
  onToggle: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <tr
      data-selected={selected}
      className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)] transition-colors"
    >
      <td className="px-4 py-3">
        <input
          type="checkbox"
          aria-label={`Select ${company.name}`}
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 cursor-pointer accent-[var(--brand-primary)]"
        />
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/companies/${company.id}`}
          className="font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
        >
          {company.name}
        </Link>
        {company.legalName && company.legalName !== company.name && (
          <div className="text-xs text-[var(--fg-tertiary)]">{company.legalName}</div>
        )}
      </td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">
        {company.domain ? (
          <a
            href={`https://${company.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--brand-primary)]"
          >
            {company.domain}
          </a>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">{company.industry ?? '—'}</td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">
        {company.employeeCount?.toLocaleString() ?? '—'}
      </td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">{company.countryCode ?? '—'}</td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          <Link to={`/companies/${company.id}`} className="btn btn-ghost btn-sm">
            View
          </Link>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm(`Delete company "${company.name}"?`)) onDelete(company.id);
            }}
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}

function NewCompanyDialog({
  onClose,
  onCreate,
  isPending,
}: {
  onClose: () => void;
  onCreate: (body: {
    name: string;
    domain?: string | null;
    industry?: string | null;
    countryCode?: string | null;
  }) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [industry, setIndustry] = useState('');
  const [countryCode, setCountryCode] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    onCreate({
      name,
      domain: domain || null,
      industry: industry || null,
      countryCode: countryCode || null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-company-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="new-company-title" className="text-lg font-semibold text-[var(--fg-primary)]">
            New company
          </h2>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
              Company name
            </label>
            <input
              className="input w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              required
              aria-required="true"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
                Domain
              </label>
              <input
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="acme.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
                Country
              </label>
              <input
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.slice(0, 2).toUpperCase())}
                placeholder="CA"
                maxLength={2}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
              Industry
            </label>
            <input
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Software"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              className="btn btn-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              disabled={isPending}
            >
              {isPending ? 'Creating…' : 'Create company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
