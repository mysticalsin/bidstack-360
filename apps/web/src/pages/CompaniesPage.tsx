import { memo, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { SpotlightTable, SpotlightTableRow } from '@/components/ui/SpotlightTable';

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

  const items = useMemo(() => companies.data?.items ?? [], [companies.data?.items]);
  const bulk = useBulkSelection(items);
  const searchTerm = filter.search ?? '';
  const stats = useMemo(() => {
    const withDomain = items.filter((company) => Boolean(company.domain)).length;
    const withIndustry = items.filter((company) => Boolean(company.industry)).length;
    const countries = new Set(items.map((company) => company.countryCode).filter(Boolean));

    return [
      { label: 'Visible companies', value: items.length.toLocaleString(), detail: 'current view' },
      {
        label: 'Domain coverage',
        value: `${withDomain}/${items.length || 0}`,
        detail: 'ready for data verification',
      },
      { label: 'Industries', value: withIndustry.toLocaleString(), detail: 'classified profiles' },
      { label: 'Countries', value: countries.size.toLocaleString(), detail: 'market coverage' },
    ];
  }, [items]);

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
      <header className="page-head flex-wrap">
        <div>
          <h1 className="page-title">Companies</h1>
          <p className="page-sub">
            {items.length} {items.length === 1 ? 'company' : 'companies'} visible in the CRM.
          </p>
        </div>
        <LiquidGlassButton onClick={() => setShowNew(true)}>
          <Icon name="plus" size={14} />
          New company
        </LiquidGlassButton>
      </header>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Company list summary"
      >
        {stats.map((stat) => (
          <Card key={stat.label} className="px-4 py-3">
            <span className="text-xs font-medium text-[var(--fg-tertiary)]">{stat.label}</span>
            <strong className="mt-1 block text-xl font-semibold text-[var(--fg-primary)] tabular-nums">
              {stat.value}
            </strong>
            <span className="text-xs text-[var(--fg-tertiary)]">{stat.detail}</span>
          </Card>
        ))}
      </section>

      <Card className="overflow-hidden">
        <div className="card-body flex flex-wrap items-center justify-between gap-3 pt-4">
          <label htmlFor="company-search" className="account-filter min-w-[min(100%,320px)]">
            <Icon name="search" size={14} ariaHidden />
            <input
              id="company-search"
              type="search"
              placeholder="Search by name or domain…"
              aria-label="Search companies"
              value={searchTerm}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('search', e.target.value);
                else next.delete('search');
                setParams(next, { replace: true });
              }}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-tertiary)]">
            <span role="status" aria-live="polite">
              {searchTerm
                ? `${items.length} result${items.length === 1 ? '' : 's'} for "${searchTerm}"`
                : 'Showing latest 50 companies'}
            </span>
            {searchTerm ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('search');
                  setParams(next, { replace: true });
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {showNew && (
        <NewCompanyDialog
          onClose={() => setShowNew(false)}
          onCreate={async (body) => {
            try {
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
            } catch {
              /* error is surfaced by the mutation toast in the hook */
            }
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
      ) : companies.isError ? (
        <ErrorState
          title="Failed to load companies"
          message={
            companies.error instanceof Error ? companies.error.message : 'Something went wrong'
          }
        />
      ) : !companies.data || companies.data.items.length === 0 ? (
        <EmptyState
          title={searchTerm ? 'No companies match your search' : 'No companies found'}
          message={
            searchTerm
              ? `Nothing matched "${searchTerm}". Try a company name or domain.`
              : 'Create the first company to start building the CRM account list.'
          }
          action={
            searchTerm ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('search');
                  setParams(next, { replace: true });
                }}
              >
                Clear search
              </Button>
            ) : (
              <Button size="sm" onClick={() => setShowNew(true)}>
                Add company
              </Button>
            )
          }
        />
      ) : (
        <Card className="overflow-hidden p-3">
          <SpotlightTable
            query={searchTerm}
            minWidth={820}
            className="[&_tr[data-selected=true]]:bg-[var(--brand-primary-tint)]/60"
          >
            <thead>
              <tr>
                <th className="w-10">
                  <label className="table-checkbox-hit">
                    <span className="sr-only">
                      {bulk.allSelected ? 'Deselect all' : 'Select all'}
                    </span>
                    <input
                      type="checkbox"
                      checked={bulk.allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = bulk.someSelected;
                      }}
                      onChange={() => bulk.toggleAll(items)}
                      className="cursor-pointer accent-[var(--brand-primary)]"
                    />
                  </label>
                </th>
                <th scope="col">Company</th>
                <th scope="col">Domain</th>
                <th scope="col">Industry</th>
                <th scope="col">Employees</th>
                <th scope="col">Country</th>
                <th scope="col" className="text-right">
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
                  onToggle={bulk.toggleOne}
                  onDelete={deleteCompany.mutate}
                  query={searchTerm}
                />
              ))}
            </tbody>
          </SpotlightTable>
        </Card>
      )}
    </div>
  );
}

const CompanyRow = memo(function CompanyRow({
  company,
  selected,
  onToggle,
  onDelete,
  query,
}: {
  company: Company;
  selected: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  query: string;
}) {
  return (
    <SpotlightTableRow
      query={query}
      searchableText={`${company.name} ${company.legalName ?? ''} ${company.domain ?? ''} ${company.industry ?? ''}`}
      data-selected={selected}
    >
      <td>
        <label className="table-checkbox-hit">
          <span className="sr-only">
            {selected ? `Deselect ${company.name}` : `Select ${company.name}`}
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
          <CompanyLogo name={company.name} domain={company.domain} size={36} />
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
            View
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="text-[var(--danger)] hover:text-[var(--danger)]"
            onClick={async () => {
              const ok = await confirmDialog({
                title: `Delete ${company.name}?`,
                description: 'This action cannot be undone.',
                confirmLabel: 'Delete',
                destructive: true,
              });
              if (ok) onDelete(company.id);
            }}
          >
            Delete
          </Button>
        </div>
      </td>
    </SpotlightTableRow>
  );
});

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

  const submit = (e: FormEvent) => {
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="New company"
        description="Create the account profile first. You can enrich firmographics and contacts after the record exists."
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label
              htmlFor="new-company-name"
              className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
            >
              Company name
            </label>
            <input
              id="new-company-name"
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
              <label
                htmlFor="new-company-domain"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                Domain
              </label>
              <input
                id="new-company-domain"
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="acme.com"
              />
            </div>
            <div>
              <label
                htmlFor="new-company-country"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                Country
              </label>
              <input
                id="new-company-country"
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.slice(0, 2).toUpperCase())}
                placeholder="CA"
                maxLength={2}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="new-company-industry"
              className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
            >
              Industry
            </label>
            <input
              id="new-company-industry"
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
      </DialogContent>
    </Dialog>
  );
}
