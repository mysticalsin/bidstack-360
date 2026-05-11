import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { CompanyLogo } from '@/components/company/CompanyLogo';
import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { formatMoney } from '@/lib/format';
import { springLayout, springSnap } from '@/lib/motion';

import type { CrmCompany, CrmDeal } from '@bidstack/shared';

type SortKey = 'name' | 'pipeline' | 'health' | 'industry';

interface AccountRow {
  company: CrmCompany;
  openDeals: number;
  pipelineMicros: number;
  totalDeals: number;
  // Coarse health proxy until real enrichment lands: weighted-pipeline / open-deals
  // banded into 4 buckets. Real CompanyHealth lives in cockpit; per-account here
  // is derived because we only have aggregate signal at the list level.
  health: 'strong' | 'good' | 'needs_attention' | 'critical';
}

export function AccountsPage() {
  const dashboard = useCrmDashboard();
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('pipeline');

  const rows = useMemo<AccountRow[]>(() => {
    if (!dashboard.data) return [];
    return dashboard.data.companies
      .map((company) => deriveAccount(company, dashboard.data!.deals))
      .filter((row) => {
        if (industry && row.company.industry !== industry) return false;
        if (search) {
          const needle = search.toLowerCase();
          return (
            row.company.name.toLowerCase().includes(needle) ||
            (row.company.domain ?? '').toLowerCase().includes(needle)
          );
        }
        return true;
      })
      .sort((a, b) => sortRows(a, b, sort));
  }, [dashboard.data, search, industry, sort]);

  const industries = useMemo(() => {
    if (!dashboard.data) return [];
    return [
      ...new Set(
        dashboard.data.companies.map((c) => c.industry).filter((i): i is string => Boolean(i)),
      ),
    ].sort();
  }, [dashboard.data]);

  if (dashboard.isLoading) return <LoadingSkeleton rows={10} />;
  if (dashboard.isError) {
    return (
      <ErrorState
        title="Couldn't load accounts"
        message={dashboard.error?.message ?? 'The CRM dashboard endpoint did not respond.'}
      />
    );
  }
  if (!dashboard.data) return <EmptyState title="No accounts yet" />;

  const totalPipeline = rows.reduce((acc, r) => acc + r.pipelineMicros, 0);
  const totalOpen = rows.reduce((acc, r) => acc + r.openDeals, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Accounts</h1>
          <div className="page-sub">
            {rows.length} {rows.length === 1 ? 'company' : 'companies'} · {totalOpen} open deals ·{' '}
            {formatMoneyMicros(totalPipeline)} weighted pipeline
          </div>
        </div>
        <div className="page-actions">
          {/* Accounts are derived from opportunity.customer + companyEnrichment
              rows. Creating an opportunity for a new customer is the canonical
              way to add a new account to the grid. */}
          <CreateOpportunityDialog
            trigger={
              <button type="button" className="btn btn-primary">
                <Icon name="plus" size={14} />
                New account
              </button>
            }
          />
        </div>
      </div>

      <section className="card" aria-label="Filters">
        <div className="card-body" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="account-filter" aria-label="Search">
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder="Search by name or domain…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="account-filter" aria-label="Industry">
            <Icon name="briefcase" size={14} />
            <select value={industry ?? ''} onChange={(e) => setIndustry(e.target.value || null)}>
              <option value="">All industries</option>
              {industries.map((ind) => (
                <option key={ind} value={ind}>
                  {titleCase(ind)}
                </option>
              ))}
            </select>
          </label>
          <label className="account-filter" aria-label="Sort">
            <Icon name="reports" size={14} />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="pipeline">Sort: pipeline value</option>
              <option value="name">Sort: name</option>
              <option value="health">Sort: health</option>
              <option value="industry">Sort: industry</option>
            </select>
          </label>
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState title="No accounts match your filters" />
      ) : (
        <motion.section
          className="account-grid"
          aria-label="Account cards"
          // Animate filter changes — surviving cards glide to new positions
          // while removed cards fade. Matches the macOS Stocks watchlist
          // reorder animation.
          layout
        >
          {rows.map((row, i) => (
            <AccountCard key={row.company.id} row={row} index={i} />
          ))}
        </motion.section>
      )}
    </>
  );
}

function AccountCard({ row, index }: { row: AccountRow; index: number }) {
  const { company, openDeals, pipelineMicros, totalDeals, health } = row;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { ...springLayout, delay: Math.min(index, 16) * 0.028 },
      }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16 } }}
      whileHover={{ y: -3, transition: springSnap }}
      whileTap={{ scale: 0.99, transition: springSnap }}
    >
      <Link to={`/accounts/${encodeURIComponent(company.id)}`} className="account-card">
        <div className="account-card-head">
          <CompanyLogo name={company.name} logo={company.logo} domain={company.domain} size={48} />
          <div className="account-card-title">
            <div className="account-card-name">{company.name}</div>
            <div className="account-card-meta">
              {titleCase(company.industry ?? 'Unknown industry')}
              {company.domain ? ` · ${company.domain}` : ''}
            </div>
          </div>
          <Badge tone={healthTone(health)}>{healthLabel(health)}</Badge>
        </div>

        <dl className="account-card-stats">
          <div>
            <dt>Open deals</dt>
            <dd>{openDeals}</dd>
          </div>
          <div>
            <dt>Pipeline</dt>
            <dd>{formatMoneyMicros(pipelineMicros)}</dd>
          </div>
          <div>
            <dt>Total deals</dt>
            <dd>{totalDeals}</dd>
          </div>
          <div>
            <dt>Employees</dt>
            <dd>{company.employeeCount ? company.employeeCount.toLocaleString() : '—'}</dd>
          </div>
        </dl>

        <div className="account-card-foot">
          Open cockpit <Icon name="arrow" size={11} />
        </div>
      </Link>
    </motion.div>
  );
}

function deriveAccount(company: CrmCompany, deals: CrmDeal[]): AccountRow {
  const matched = deals.filter(
    (d) =>
      d.companyId === company.id || d.companyName?.toLowerCase() === company.name.toLowerCase(),
  );
  const open = matched.filter((d) => d.stage !== 'closed_won' && d.stage !== 'closed_lost');
  const pipelineMicros = open.reduce(
    (acc, d) => acc + Math.round(d.amountMicros * ((d.probability ?? 50) / 100)),
    0,
  );
  // Health proxy: 0 → critical, <250k → needs_attention, <2M → good, ≥2M → strong.
  const health: AccountRow['health'] =
    pipelineMicros === 0
      ? 'critical'
      : pipelineMicros < 250_000_000_000
        ? 'needs_attention'
        : pipelineMicros < 2_000_000_000_000
          ? 'good'
          : 'strong';
  return {
    company,
    openDeals: open.length,
    pipelineMicros,
    totalDeals: matched.length,
    health,
  };
}

function sortRows(a: AccountRow, b: AccountRow, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.company.name.localeCompare(b.company.name);
    case 'pipeline':
      return b.pipelineMicros - a.pipelineMicros;
    case 'health': {
      const order = { strong: 0, good: 1, needs_attention: 2, critical: 3 };
      return order[a.health] - order[b.health];
    }
    case 'industry':
      return (a.company.industry ?? '').localeCompare(b.company.industry ?? '');
  }
}

function healthTone(h: AccountRow['health']) {
  return h === 'strong'
    ? 'jade'
    : h === 'good'
      ? 'blue'
      : h === 'needs_attention'
        ? 'amber'
        : 'tomato';
}

function healthLabel(h: AccountRow['health']) {
  return h === 'strong'
    ? 'Strong'
    : h === 'good'
      ? 'Good'
      : h === 'needs_attention'
        ? 'Watch'
        : 'At risk';
}

function formatMoneyMicros(micros: number): string {
  return formatMoney(micros / 1_000_000, 'EUR');
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
