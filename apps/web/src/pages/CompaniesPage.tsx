import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';

import { useCompanies, useCreateCompany, useDeleteCompany } from '@/hooks/useCompanies';
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
          <label className="account-filter" aria-label="Search companies">
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder="Search by name or domain…"
              value={filter.search ?? ''}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('search', e.target.value);
                else next.delete('search');
                setParams(next, { replace: true });
              }}
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

      {companies.isLoading ? (
        <LoadingSkeleton rows={8} />
      ) : !companies.data || companies.data.items.length === 0 ? (
        <EmptyState title="No companies found" />
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--fg-tertiary)]">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Domain</th>
                  <th className="px-4 py-3 font-medium">Industry</th>
                  <th className="px-4 py-3 font-medium">Employees</th>
                  <th className="px-4 py-3 font-medium">Country</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {companies.data.items.map((c) => (
                  <CompanyRow key={c.id} company={c} onDelete={(id) => deleteCompany.mutate(id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CompanyRow({ company, onDelete }: { company: Company; onDelete: (id: string) => void }) {
  return (
    <tr className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)] transition-colors">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">New company</h2>
          <button
            type="button"
            className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
            onClick={onClose}
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
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
                Domain
              </label>
              <input
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
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
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
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
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Software"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
