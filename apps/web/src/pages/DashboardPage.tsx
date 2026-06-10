import '../styles/cockpit.css';

import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  ActivityTimelineCard,
  BusinessSnapshotCard,
  CommandCenter,
  DataTrustCard,
  HealthScoreCard,
  KeyContactsCard,
  KpiRow,
  KpiSidebar,
  LiveDataMeshCard,
  OpenIssuesCard,
  PageHead,
  PipelineByStageCard,
  RecentOpportunitiesCard,
  SalesIntelligencePanel,
  TechStackCard,
  UpsellFilesCard,
} from '@/components/cockpit';
import { OrgDashboard } from '@/components/dashboard/OrgDashboard';
import { FilesPanel } from '@/components/files/FilesPanel';
import { AccountIntelPanel } from '@/components/account-intel/AccountIntelPanel';
import { Reveal } from '@/components/motion/Reveal';
import { NotesPanel } from '@/components/notes/NotesPanel';
import { DashboardSkeleton } from '@/components/skeletons/PageSkeletons';
import { ErrorState } from '@/components/ui/StateMessages';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { useSalesIntelligence } from '@/hooks/useSalesIntelligence';
import { useTasks } from '@/hooks/useTasks';
import { daysUntil } from '@/lib/format';
import { useAccountHistory } from '@/stores/accountHistory';
import { ApiError } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { useEnrichCompany } from '@/hooks/useEnrichCompany';
import type { CrmDashboardSnapshot } from '@bidstack/shared';

// DashboardPage doubles as both the org-wide /dashboard view (no
// accountId) and the per-customer /accounts/:accountId cockpit. The
// useCrmDashboard hook switches its server query based on accountId, so
// the cockpit snapshot in `dashboard.data.cockpit` is always pre-selected
// for the right company — we only need to render the layout here.
export function DashboardPage() {
  const { accountId } = useParams<{ accountId?: string }>();
  return (
    <>
      <h1 className="sr-only">Dashboard</h1>
      {!accountId ? <OrgDashboard /> : <AccountCockpitPage accountId={accountId} />}
    </>
  );
}

function AccountCockpitPage({ accountId }: { accountId: string }) {
  const dashboard = useCrmDashboard(accountId);
  const report = usePipelineReport();
  const salesIntelligence = useSalesIntelligence();
  const opps = useOpportunities({ limit: 5 });
  const tasks = useTasks();
  // Hooks must be called in the same order every render — including after
  // any early returns below. The visit-tracker reads the resolved company
  // name from the cockpit, but the cockpit isn't loaded yet on the first
  // render, so we resolve the name *here* (before any conditional return)
  // and let the effect itself guard on its presence.
  const visit = useAccountHistory((s) => s.visit);
  const visitName = dashboard.data?.cockpit.company.name ?? '';
  useEffect(() => {
    if (accountId && visitName) visit(accountId, visitName);
  }, [accountId, visitName, visit]);

  const isAdmin = useIsAdmin();
  const enrich = useEnrichCompany();
  const company = dashboard.data?.cockpit.company;
  const companyId = company?.id;
  const companyName = company?.name;
  const companyDomain = company?.domain;
  const companyIndustry = company?.industry;
  const companyWebsite = company?.website;

  const strategicIntelFreshness = company?.strategicIntel?.freshness;

  useEffect(() => {
    if (
      isAdmin &&
      companyId &&
      companyName &&
      ((!companyDomain && !companyIndustry) || strategicIntelFreshness === 'stale') &&
      enrich.status === 'idle'
    ) {
      enrich.mutate({
        id: companyId,
        name: companyName,
        ...(companyDomain ? { domain: companyDomain } : {}),
        ...(companyWebsite ? { website: companyWebsite } : {}),
      });
    }
  }, [isAdmin, companyId, companyName, companyDomain, companyIndustry, companyWebsite, enrich, strategicIntelFreshness]);

  // Truly overdue (daysUntil < 0) only — matches the Sidebar badge so the two
  // counts can't disagree. Tasks with no dueDate are excluded.
  const overdueCount = useMemo(
    () =>
      tasks.data?.items.filter((t) => {
        const d = daysUntil(t.dueDate);
        return d !== null && d < 0 && t.status !== 'done';
      }).length ?? 0,
    [tasks.data?.items],
  );

  const cachedSnapshot = useMemo(() => {
    if (!accountId) return null;
    try {
      const stored = sessionStorage.getItem(`bidstack:account-cockpit:${accountId}`);
      if (stored) return JSON.parse(stored) as CrmDashboardSnapshot;
    } catch {
      // ignore parse errors
    }
    return null;
  }, [accountId]);

  useEffect(() => {
    if (dashboard.data && accountId) {
      sessionStorage.setItem(`bidstack:account-cockpit:${accountId}`, JSON.stringify(dashboard.data));
    }
  }, [dashboard.data, accountId]);

  const isTransientError =
    dashboard.isError && !(dashboard.error instanceof ApiError && dashboard.error.status === 404);
  const snapshot = dashboard.data ?? (isTransientError ? cachedSnapshot : null);

  if (dashboard.isLoading && !snapshot) {
    return <DashboardSkeleton />;
  }

  if (!snapshot) {
    return (
      <ErrorState
        title="Couldn't load the CRM cockpit"
        message={dashboard.error?.message ?? 'The CRM dashboard endpoint did not respond.'}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void dashboard.refetch()}
            >
              Retry
            </button>
            <Link to="/accounts" className="btn btn-secondary">
              Back to accounts
            </Link>
          </div>
        }
      />
    );
  }

  const cockpit = snapshot.cockpit;
  const isAccountView = Boolean(accountId);
  const accountOpps = opps.data?.items.filter(
    (o) => o.customer.toLowerCase() === cockpit.company.name.toLowerCase(),
  );

  return (
    <>
      {dashboard.isError && (
        <div role="status" className="bg-yellow-50 text-yellow-800 px-4 py-2 text-sm text-center rounded-md mb-4 flex items-center justify-center gap-2">
          <span>Warning: Live refresh failed, showing the last verified snapshot.</span>
          <button type="button" onClick={() => void dashboard.refetch()} className="font-semibold underline hover:no-underline">
            Retry
          </button>
        </div>
      )}
      <PageHead cockpit={cockpit} accountView={isAccountView} />
      <KpiRow cockpit={cockpit} />
      <CommandCenter cockpit={cockpit} />

      <section className="cockpit-grid" aria-label="Account cockpit">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Reveal>
            <TechStackCard cockpit={cockpit} />
          </Reveal>

          <Reveal delay={0.04}>
            <div className="dash-row-3">
              <BusinessSnapshotCard cockpit={cockpit} />
              <OpenIssuesCard risks={cockpit.risks} compliance={cockpit.compliance} />
              <PipelineByStageCard report={report.data} />
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <SalesIntelligencePanel report={salesIntelligence} />
          </Reveal>

          <Reveal delay={0.12}>
            <RecentOpportunitiesCard
              opps={opps}
              accountName={cockpit.company.name}
              items={accountOpps}
            />
          </Reveal>

          <Reveal delay={0.16}>
            <ActivityTimelineCard cockpit={cockpit} />
          </Reveal>
        </div>

        <aside className="cockpit-side" aria-label="Cockpit details">
          <Reveal>
            <HealthScoreCard cockpit={cockpit} />
          </Reveal>
          <Reveal delay={0.04}>
            <KpiSidebar
              snapshot={snapshot}
              overdueCount={overdueCount}
              tasksLoading={tasks.isLoading}
            />
          </Reveal>
          <Reveal delay={0.08}>
            <DataTrustCard cockpit={cockpit} />
          </Reveal>
          <Reveal delay={0.12}>
            <LiveDataMeshCard cockpit={cockpit} />
          </Reveal>
          <Reveal delay={0.16}>
            <KeyContactsCard cockpit={cockpit} />
          </Reveal>
          <Reveal delay={0.2}>
            <NotesPanel
              accountId={accountId}
              companyName={cockpit.company.name}
              domain={cockpit.company.domain}
            />
          </Reveal>
          <Reveal delay={0.24}>
            {accountId ? <FilesPanel accountId={accountId} /> : <UpsellFilesCard />}
          </Reveal>
          <Reveal delay={0.28}>
            {accountId ? <AccountIntelPanel accountId={accountId} /> : null}
          </Reveal>
        </aside>
      </section>
    </>
  );
}
