import { motion, useReducedMotion } from 'framer-motion';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';

import { CompanyLogo } from '@/components/company/CompanyLogo';
import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { SpotlightSurface } from '@/components/motion/SpotlightSurface';
import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useAutopopulateSalesCompanies } from '@/hooks/useAutopopulateSalesCompanies';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { formatMoneyMicros } from '@/lib/format';
import { springLayout, springSnap, springSoft } from '@/lib/motion';

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
  const autopopulate = useAutopopulateSalesCompanies();
  const reducedMotion = useReducedMotion();
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
  const logoCoverage = rows.filter((r) => Boolean(r.company.logo?.url)).length;
  const enrichedAccounts = rows.filter((r) => r.company.source === 'enrichment').length;
  const healthyProviders = dashboard.data.providerHealth.filter(
    (p) => p.status === 'healthy',
  ).length;
  const providerCount = dashboard.data.providerHealth.length;

  return (
    <>
      <motion.div
        className="page-head motion-page-head"
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(6px)' }}
        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={springSoft}
      >
        <div>
          <h1 className="page-title">Account Dashboard</h1>
          <div className="page-sub">
            {rows.length} {rows.length === 1 ? 'company' : 'companies'} · {totalOpen} open deals ·{' '}
            {formatMoneyMicros(totalPipeline, 'EUR')} weighted pipeline
          </div>
        </div>
        <div className="page-actions">
          {autopopulate.data ? (
            <div className="account-sync-result">
              {autopopulate.data.enriched} enriched / {autopopulate.data.cached} cached
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={autopopulate.isPending}
            onClick={() => autopopulate.mutate({ limit: 20 })}
            title="Sync top Odoo sale.order customers into enriched CRM accounts"
          >
            {autopopulate.isPending ? (
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
                aria-hidden
              />
            ) : (
              <Icon name="download" size={14} />
            )}
            {autopopulate.isPending ? 'Syncing...' : 'Sync Odoo accounts'}
          </button>
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
      </motion.div>

      <section className="account-dashboard-strip" aria-label="Account source coverage">
        <SourceStat label="Accounts" value={rows.length.toLocaleString()} detail="portfolio" />
        <SourceStat
          label="Open deals"
          value={totalOpen.toLocaleString()}
          detail="Twenty pipeline"
        />
        <SourceStat
          label="Weighted pipeline"
          value={formatMoneyMicros(totalPipeline, 'EUR')}
          detail="bid and presales"
        />
        <SourceStat
          label="Logo coverage"
          value={`${logoCoverage}/${rows.length || 0}`}
          detail="brand assets"
        />
        <SourceStat
          label="Enriched profiles"
          value={enrichedAccounts.toLocaleString()}
          detail="open-source cache"
        />
        <SourceStat
          label="Sources healthy"
          value={`${healthyProviders}/${providerCount}`}
          detail="API mesh"
        />
      </section>
      <IntegrationMotionRail
        providers={dashboard.data.providerHealth.map((provider) => ({
          name: provider.provider,
          status: provider.status,
        }))}
      />

      <motion.section
        className="card account-filter-card"
        aria-label="Filters"
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSoft, delay: reducedMotion ? 0 : 0.08 }}
      >
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
      </motion.section>

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
  const sources = sourcePillsFor(company);
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
      <SpotlightSurface className="account-card-shell" tone={spotlightTone(health)}>
        <Link
          to={`/accounts/${encodeURIComponent(company.id)}`}
          className="account-card"
          aria-label={`Open ${company.name} customer cockpit`}
        >
          {company.imageUrl ? (
            <img
              src={company.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="account-card-cover"
            />
          ) : null}
          <div className="account-card-head">
            <CompanyLogo
              name={company.name}
              logo={company.logo}
              domain={company.domain}
              size={52}
            />
            <div className="account-card-title">
              <div className="account-card-name">{company.name}</div>
              <div className="account-card-meta">
                {titleCase(company.industry ?? 'Unknown industry')}
                {company.domain ? ` · ${company.domain}` : ''}
              </div>
            </div>
            <Badge tone={healthTone(health)}>{healthLabel(health)}</Badge>
          </div>

          <div className="account-card-sources" aria-label={`${company.name} data sources`}>
            {sources.map((source, sourceIndex) => (
              <motion.span
                key={source}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...springSnap, delay: Math.min(sourceIndex, 4) * 0.035 }}
              >
                {source}
              </motion.span>
            ))}
          </div>

          <dl className="account-card-stats">
            <div>
              <dt>Open deals</dt>
              <dd>
                <AnimatedMetric value={openDeals.toLocaleString()} />
              </dd>
            </div>
            <div>
              <dt>Pipeline</dt>
              <dd>
                <AnimatedMetric value={formatMoneyMicros(pipelineMicros, 'EUR')} />
              </dd>
            </div>
            <div>
              <dt>Total deals</dt>
              <dd>
                <AnimatedMetric value={totalDeals.toLocaleString()} />
              </dd>
            </div>
            <div>
              <dt>Employees</dt>
              <dd>{company.employeeCount ? company.employeeCount.toLocaleString() : '—'}</dd>
            </div>
          </dl>

          <div className="account-card-confidence">
            <span>Confidence</span>
            <strong>
              <AnimatedMetric value={`${Math.round(company.confidence * 100)}%`} />
            </strong>
          </div>

          <div className="account-card-foot">
            View Stack360 cockpit <Icon name="arrow" size={11} />
          </div>
        </Link>
      </SpotlightSurface>
    </motion.div>
  );
}

function SourceStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <SpotlightSurface className="account-source-stat" tone="blue">
      <span>{label}</span>
      <strong>
        <AnimatedMetric value={value} />
      </strong>
      <small>{detail}</small>
    </SpotlightSurface>
  );
}

function IntegrationMotionRail({
  providers,
}: {
  providers: Array<{ name: string; status: string }>;
}) {
  const visible = providers.length
    ? providers.slice(0, 8)
    : [
        { name: 'Odoo', status: 'healthy' },
        { name: 'Twenty', status: 'healthy' },
        { name: 'Apollo', status: 'disabled' },
        { name: 'TradingView', status: 'healthy' },
      ];
  return (
    <div className="integration-motion-rail" aria-label="Live CRM integration orchestration">
      <span className="rail-label">Live integration flow</span>
      <div className="rail-track" aria-hidden>
        {visible.map((provider, index) => (
          <span
            key={`${provider.name}-${index}`}
            className={`rail-node rail-node-${provider.status}`}
            style={{ '--rail-delay': `${index * 0.12}s` } as CSSProperties}
          >
            {sourceLabel(provider.name)}
          </span>
        ))}
      </div>
      <span className="rail-caption">Odoo, Twenty, open APIs, enrichment jobs</span>
    </div>
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

function spotlightTone(h: AccountRow['health']): 'blue' | 'jade' | 'amber' | 'purple' {
  if (h === 'strong') return 'jade';
  if (h === 'good') return 'blue';
  if (h === 'needs_attention') return 'amber';
  return 'purple';
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function sourcePillsFor(company: CrmCompany): string[] {
  const pills = new Set<string>();
  pills.add(company.source === 'enrichment' ? 'Enriched' : sourceLabel(company.source));
  if (company.logo?.source) pills.add(`Logo: ${logoSourceLabel(company.logo.source)}`);
  for (const source of company.sourceAttribution.slice(0, 2)) {
    pills.add(sourceLabel(source.source));
  }
  if (company.sourceAttribution.length === 0) pills.add('Twenty');
  return [...pills].slice(0, 4);
}

function sourceLabel(source: string): string {
  const normalized = source.toLowerCase();
  if (normalized.includes('odoo')) return 'Odoo';
  if (normalized.includes('twenty')) return 'Twenty';
  if (normalized.includes('apollo')) return 'Apollo';
  if (normalized.includes('brandfetch')) return 'Brandfetch';
  if (normalized.includes('logo_dev')) return 'Logo.dev';
  if (normalized.includes('official')) return 'Official';
  if (normalized.includes('favicon')) return 'Favicon';
  if (normalized.includes('bidstack')) return 'BidStack';
  if (normalized.includes('enrichment')) return 'Enriched';
  return titleCase(source.replace(/[-.]/g, ' '));
}

function logoSourceLabel(source: NonNullable<CrmCompany['logo']>['source']): string {
  if (source === 'logo_dev') return 'Logo.dev';
  if (source === 'official_website') return 'Official';
  return sourceLabel(source);
}
