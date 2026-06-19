import '../styles/cockpit.css';

import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
  RevenueEvolutionCard,
  WinLossCard,
  TechStackCard,
  UpsellFilesCard,
} from '@/components/cockpit';
import { OrgDashboard } from '@/components/dashboard/OrgDashboard';
import { FilesPanel } from '@/components/files/FilesPanel';
import { AccountIntelPanel } from '@/components/account-intel/AccountIntelPanel';
import { InfoSearchLeadsCard } from '@/components/account-intel/InfoSearchLeadsCard';
import { CrossSellCard } from '@/components/account-intel/CrossSellCard';
import { GovernanceLogCard } from '@/components/account-intel/GovernanceLogCard';
import { SpotlightRefsCard } from '@/components/account-intel/SpotlightRefsCard';
import { AccountNewsSignalCard } from '@/components/account-intel/AccountNewsSignalCard';
import { ContractAgreementsCard } from '@/components/account-intel/ContractAgreementsCard';
import {
  WinLossReasonsCard,
  type ClosedOpp,
} from '@/components/account-intel/WinLossReasonsCard';
import { CockpitCustomizeMenu } from '@/components/cockpit/CockpitCustomizeMenu';
import { Reveal } from '@/components/motion/Reveal';
import { NotesPanel } from '@/components/notes/NotesPanel';
import { DashboardSkeleton } from '@/components/skeletons/PageSkeletons';
import { ErrorState } from '@/components/ui/StateMessages';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { useTasks } from '@/hooks/useTasks';
import { daysUntil } from '@/lib/format';
import { useAccountHistory } from '@/stores/accountHistory';
import { useCockpitLayout } from '@/stores/cockpitLayout';
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
  const { t } = useTranslation('crm');
  return (
    <>
      <h1 className="sr-only">{t('dashboard.srHeading', 'Dashboard')}</h1>
      {!accountId ? <OrgDashboard /> : <AccountCockpitPage accountId={accountId} />}
    </>
  );
}

function AccountCockpitPage({ accountId }: { accountId: string }) {
  const { t } = useTranslation('crm');
  const dashboard = useCrmDashboard(accountId);
  const report = usePipelineReport();
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
  // Per-user block visibility (Customize menu). Default-visible: an unknown/new
  // id is shown unless the user explicitly turned it off.
  const visibleCards = useCockpitLayout((s) => s.visibleCards);
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
        title={t('dashboard.cockpitErrorTitle', "Couldn't load the account cockpit")}
        message={dashboard.error?.message ?? t('dashboard.cockpitErrorMessage', 'The dashboard endpoint did not respond.')}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void dashboard.refetch()}
            >
              {t('dashboard.retry', 'Retry')}
            </button>
            <Link to="/accounts" className="btn btn-secondary">
              {t('dashboard.backToAccounts', 'Back to accounts')}
            </Link>
          </div>
        }
      />
    );
  }

  const cockpit = snapshot.cockpit;
  const isAccountView = Boolean(accountId);
  const accountRecordKey = accountId.trim() || cockpit.company.name;
  const accountOpps = opps.data?.items.filter(
    (o) => o.customer.toLowerCase() === cockpit.company.name.toLowerCase(),
  );
  // A card shows unless the user explicitly hid it (default-visible).
  const show = (id: string) => visibleCards[id] !== false;
  // This account's closed deals, for win/loss reason capture.
  const closedOpps: ClosedOpp[] = (accountOpps ?? [])
    .filter((o) => o.stage === 'closed_won' || o.stage === 'closed_lost')
    .map((o) => ({ id: o.id, name: o.name, outcome: o.stage === 'closed_won' ? 'won' : 'lost' }));

  return (
    <>
      {dashboard.isError && (
        <div role="status" className="bg-yellow-50 text-yellow-800 px-4 py-2 text-sm text-center rounded-md mb-4 flex items-center justify-center gap-2">
          <span>{t('dashboard.liveRefreshFailed', 'Warning: Live refresh failed, showing the last verified snapshot.')}</span>
          <button type="button" onClick={() => void dashboard.refetch()} className="font-semibold underline hover:no-underline">
            {t('dashboard.retry', 'Retry')}
          </button>
        </div>
      )}
      <PageHead cockpit={cockpit} accountView={isAccountView} />
      {isAccountView && (
        <div className="flex justify-end">
          <CockpitCustomizeMenu />
        </div>
      )}
      <KpiRow cockpit={cockpit} />
      <CommandCenter cockpit={cockpit} />

      <div className="mt-1 flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('dashboard.portfolioIntelTitle', 'Portfolio sales intelligence')}
        </h2>
        <p className="text-xs text-[var(--fg-tertiary)]">
          {t('dashboard.portfolioIntelSubtitle', 'Pipeline, risks, contacts, and records for this account.')}
        </p>
      </div>
      <section className="cockpit-grid" aria-label={t('dashboard.accountCockpitAria', 'Account cockpit')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {show('techStack') && (
            <Reveal>
              <TechStackCard cockpit={cockpit} />
            </Reveal>
          )}

          {(show('businessSnapshot') || show('openIssues') || show('pipelineStage')) && (
            <Reveal delay={0.04}>
              <div className="dash-row-3">
                {show('businessSnapshot') && <BusinessSnapshotCard cockpit={cockpit} />}
                {show('openIssues') && (
                  <OpenIssuesCard risks={cockpit.risks} compliance={cockpit.compliance} />
                )}
                {show('pipelineStage') && <PipelineByStageCard report={report.data} />}
              </div>
            </Reveal>
          )}

          {show('recentOpportunities') && (
            <Reveal delay={0.12}>
              <RecentOpportunitiesCard
                opps={opps}
                accountName={cockpit.company.name}
                items={accountOpps}
              />
            </Reveal>
          )}

          {show('activityTimeline') && (
            <Reveal delay={0.16}>
              <ActivityTimelineCard cockpit={cockpit} />
            </Reveal>
          )}

          {show('crossSell') && (
            <Reveal delay={0.18}>
              <CrossSellCard accountKey={accountRecordKey} />
            </Reveal>
          )}

          {show('governance') && (
            <Reveal delay={0.2}>
              <GovernanceLogCard accountKey={accountRecordKey} />
            </Reveal>
          )}

          {show('spotlightRefs') && (
            <Reveal delay={0.22}>
              <SpotlightRefsCard accountKey={accountRecordKey} />
            </Reveal>
          )}

          {show('contracts') && (
            <Reveal delay={0.24}>
              <ContractAgreementsCard accountKey={accountRecordKey} />
            </Reveal>
          )}

          {show('newsSignals') && (
            <Reveal delay={0.26}>
              <AccountNewsSignalCard accountId={companyName ?? cockpit.company.id} />
            </Reveal>
          )}
        </div>

        <aside className="cockpit-side" aria-label={t('dashboard.cockpitDetailsAria', 'Cockpit details')}>
          {show('healthScore') && (
            <Reveal>
              <HealthScoreCard cockpit={cockpit} />
            </Reveal>
          )}
          {show('revenueEvolution') && (
            <Reveal delay={0.02}>
              <RevenueEvolutionCard cockpit={cockpit} />
            </Reveal>
          )}
          {show('winLoss') && (
            <Reveal delay={0.03}>
              <WinLossCard cockpit={cockpit} />
            </Reveal>
          )}
          {show('winLossReasons') && (
            <Reveal delay={0.03}>
              <WinLossReasonsCard closedOpps={closedOpps} />
            </Reveal>
          )}
          {show('infoSearchLeads') && (
            <Reveal delay={0.03}>
              <InfoSearchLeadsCard account={cockpit.company.name} />
            </Reveal>
          )}
          {show('kpiSidebar') && (
            <Reveal delay={0.04}>
              <KpiSidebar
                snapshot={snapshot}
                overdueCount={overdueCount}
                tasksLoading={tasks.isLoading}
              />
            </Reveal>
          )}
          {show('dataTrust') && (
            <Reveal delay={0.08}>
              <DataTrustCard cockpit={cockpit} />
            </Reveal>
          )}
          {show('liveDataMesh') && (
            <Reveal delay={0.12}>
              <LiveDataMeshCard cockpit={cockpit} />
            </Reveal>
          )}
          {show('keyContacts') && (
            <Reveal delay={0.16}>
              <KeyContactsCard cockpit={cockpit} />
            </Reveal>
          )}
          {show('notes') && (
            <Reveal delay={0.2}>
              <NotesPanel
                accountId={accountId}
                companyName={cockpit.company.name}
                domain={cockpit.company.domain}
              />
            </Reveal>
          )}
          {show('files') && (
            <Reveal delay={0.24}>
              {accountId ? <FilesPanel accountId={accountId} /> : <UpsellFilesCard />}
            </Reveal>
          )}
          {show('accountIntel') && accountId && (
            <Reveal delay={0.28}>
              <AccountIntelPanel accountId={accountId} />
            </Reveal>
          )}
        </aside>
      </section>
    </>
  );
}
