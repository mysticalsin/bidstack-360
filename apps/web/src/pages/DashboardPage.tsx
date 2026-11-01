import '../styles/cockpit.css';

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
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
  OpenIssuesCard,
  PageHead,
  RecentOpportunitiesCard,
  TechStackCard,
  FundingEligibilityCard,
  UpsellFilesCard,
} from '@/components/cockpit';
import { OrgDashboard } from '@/components/dashboard/OrgDashboard';
import { AccountWatchdogSection } from '@/components/watchdog/AccountWatchdogSection';
import { FinancialHealthSection } from '@/components/financials/FinancialHealthSection';
import { PulseHero } from '@/components/signals/PulseHero';
import { KeyNumbersStrip } from '@/components/positioning/KeyNumbersStrip';
import { WhatToPosition } from '@/components/positioning/WhatToPosition';
import { AccountVisuals } from '@/components/account/AccountVisuals';
import { AgreementsSummaryCard } from '@/components/agreements/AgreementsSummaryCard';
import { WhoWeMetCard } from '@/components/meetings/WhoWeMetCard';
import { OrgChartCard } from '@/components/orgchart/OrgChartCard';
import { FirmographicsStrip } from '@/components/enrichment/FirmographicsStrip';
import { HiringNowCard } from '@/components/enrichment/HiringNowCard';
import { PotentialProjectsCard } from '@/components/enrichment/PotentialProjectsCard';
import { OppDrill } from '@/components/drill/OppDrill';
import type { OppDrillFilter } from '@/components/drill/filterOpps';
import { useOpportunityRows } from '@/hooks/useOpportunityRows';
import { AccountDetailsFold } from '@/components/account/AccountDetailsFold';
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
import { recentItemsFromDeals } from '@/components/cockpit/RecentOpportunitiesCard';
import { CockpitCustomizeMenu } from '@/components/cockpit/CockpitCustomizeMenu';
import { Reveal } from '@/components/motion/Reveal';
import { NotesPanel } from '@/components/notes/NotesPanel';
import { DashboardSkeleton } from '@/components/skeletons/PageSkeletons';
import { ErrorState } from '@/components/ui/StateMessages';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { useTasks } from '@/hooks/useTasks';
import { daysUntil } from '@/lib/format';
import { useAccountHistory } from '@/stores/accountHistory';
import { useCockpitLayout } from '@/stores/cockpitLayout';
import { ApiError } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { useEnrichCompany } from '@/hooks/useEnrichCompany';
import type { CrmDashboardSnapshot } from '@bidstack/shared';

// v21: the timeline and initiatives sit below the fold, so they load as their
// own chunks behind fixed-height skeletons (no layout shift).
const SignalsTimeline = lazy(() => import('@/components/signals/SignalsTimeline'));
const InitiativesBoard = lazy(() => import('@/components/signals/InitiativesBoard'));
const sectionSkeleton = (h: number) => (
  <div className="sg" aria-busy="true" style={{ marginBottom: 24 }}>
    <div className="sg-skel" style={{ minHeight: h }} />
  </div>
);

// DashboardPage doubles as both the org-wide /dashboard view (no
// accountId) and the per-customer /accounts/:accountId cockpit. The
// useCrmDashboard hook switches its server query based on accountId, so
// the cockpit snapshot in `dashboard.data.cockpit` is always pre-selected
// for the right company — we only need to render the layout here.
export function DashboardPage() {
  const { accountId } = useParams<{ accountId?: string }>();
  // Each branch renders its own single H1 (org title or the company name).
  return !accountId ? <OrgDashboard /> : <AccountCockpitPage accountId={accountId} />;
}

function AccountCockpitPage({ accountId }: { accountId: string }) {
  const { t } = useTranslation('crm');
  const dashboard = useCrmDashboard(accountId);
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
  // Account bid drill: header numbers and the stage bars open one side sheet
  // listing this account's bids (progressive disclosure, Tony 15:21).
  const [drill, setDrill] = useState<OppDrillFilter | null>(null);
  const oppRows = useOpportunityRows();
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
  // A matching customer name is not a link. The snapshot deals for this
  // account are the rows whose companyId points here.
  const companyDeals = snapshot.deals.filter((deal) => deal.companyId === cockpit.company.id);
  // A card shows unless the user explicitly hid it (default-visible).
  const show = (id: string) => visibleCards[id] !== false;
  // This account's closed deals, for win/loss reason capture.
  const closedOpps: ClosedOpp[] = companyDeals
    .filter((deal) => deal.stage === 'closed_won' || deal.stage === 'closed_lost')
    .map((deal) => ({
      id: deal.id,
      name: deal.name,
      outcome: deal.stage === 'closed_won' ? 'won' : 'lost',
    }));

  // Everything below the watchdog: customise menu, KPI strip and the long
  // cockpit grid. On the account page it folds behind "Account details".
  const cockpitBody = (
    <>
      {isAccountView && (
        <div className="flex justify-end">
          <CockpitCustomizeMenu />
        </div>
      )}
      <KpiRow cockpit={cockpit} />
      {!isAccountView && <CommandCenter cockpit={cockpit} />}

      <section className="cockpit-grid" aria-label={t('dashboard.accountCockpitAria', 'Account cockpit')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {(show('businessSnapshot') || show('openIssues')) && (
            <Reveal delay={0.04}>
              <div className="dash-row-3">
                {show('businessSnapshot') && <BusinessSnapshotCard cockpit={cockpit} />}
                {show('openIssues') && (
                  <OpenIssuesCard
                    risks={cockpit.risks}
                    compliance={cockpit.compliance}
                    openRiskCount={cockpit.openRiskCount}
                    openComplianceCount={cockpit.openComplianceCount}
                    risksCapped={cockpit.risksCapped}
                    complianceCapped={cockpit.complianceCapped}
                  />
                )}
              </div>
            </Reveal>
          )}

          {show('techStack') && (
            <Reveal>
              <TechStackCard cockpit={cockpit} />
            </Reveal>
          )}

          {show('techStack') && (
            <Reveal delay={0.04}>
              <FundingEligibilityCard cockpit={cockpit} />
            </Reveal>
          )}

          {show('recentOpportunities') && (
            <Reveal delay={0.12}>
              <RecentOpportunitiesCard
                accountName={cockpit.company.name}
                items={recentItemsFromDeals(companyDeals)}
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
          {show('kpiSidebar') && !isAccountView && (
            <Reveal delay={0.04}>
              <KpiSidebar
                snapshot={snapshot}
                overdueCount={overdueCount}
                tasksLoading={tasks.isLoading}
                account
              />
            </Reveal>
          )}
          {show('dataTrust') && (
            <Reveal delay={0.08}>
              <DataTrustCard cockpit={cockpit} />
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
          {show('healthScore') && (
            <Reveal delay={0.3}>
              <HealthScoreCard cockpit={cockpit} />
            </Reveal>
          )}
        </aside>
      </section>
    </>
  );

  return (
    <>
      {dashboard.isError && (
        // Theme-token amber pair (not raw yellow-* utilities) so the banner
        // follows light/dark like every other surface on this screen.
        <div role="status" className="bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)] px-4 py-1 text-sm text-center rounded-md mb-4 flex items-center justify-center gap-2">
          <span>{t('dashboard.liveRefreshFailed', 'Warning: Live refresh failed, showing the last verified snapshot.')}</span>
          <button type="button" onClick={() => void dashboard.refetch()} className="min-h-[44px] rounded-md px-2 font-semibold underline hover:no-underline">
            {t('dashboard.retry', 'Retry')}
          </button>
        </div>
      )}
      <PageHead cockpit={cockpit} accountView={isAccountView} onDrill={isAccountView ? (status) => setDrill({ status }) : undefined} />
      {/* Account view (v21): header, then the pulse (traction or decline in five
          seconds), the signals timeline, the watchdog feed and the initiatives
          board; firmographics, hiring and the rest follow, details fold last. The command-center hero repeated the
          name and next move the header already carries, so it is org-only. */}
      {isAccountView && cockpit.company.id ? (
        <>
          <KeyNumbersStrip companyId={cockpit.company.id} />
          <WhatToPosition companyId={cockpit.company.id} />
          <div id="pulse" style={{ scrollMarginTop: 80 }}>
            <PulseHero companyId={cockpit.company.id} />
          </div>
          <Suspense fallback={sectionSkeleton(318)}>
            <SignalsTimeline companyId={cockpit.company.id} />
          </Suspense>
          <AccountWatchdogSection companyId={cockpit.company.id} />
          <Suspense fallback={sectionSkeleton(280)}>
            <InitiativesBoard companyId={cockpit.company.id} />
          </Suspense>
          <div id="financial-health" style={{ scrollMarginTop: 80 }}>
            <FinancialHealthSection companyId={cockpit.company.id} />
          </div>
          <div id="firmographics" style={{ scrollMarginTop: 80 }}>
            <FirmographicsStrip companyId={cockpit.company.id} />
          </div>
        </>
      ) : null}
      {isAccountView && cockpit.company.id ? (
        <div className="en-row2" style={{ marginBottom: 24 }}>
          <div id="hiring-now" style={{ scrollMarginTop: 80, minWidth: 0 }}>
            <HiringNowCard companyId={cockpit.company.id} />
          </div>
          <PotentialProjectsCard companyId={cockpit.company.id} />
        </div>
      ) : null}
      {isAccountView && cockpit.company.id ? (
        <>
          <div id="deals" style={{ scrollMarginTop: 80 }}>
            <AccountVisuals companyId={cockpit.company.id} companyName={cockpit.company.name} onDrill={setDrill} />
          </div>
          <div id="who-we-met" style={{ scrollMarginTop: 80 }}>
            <WhoWeMetCard companyId={cockpit.company.id} companyName={cockpit.company.name} />
          </div>
          <OrgChartCard companyId={cockpit.company.id} />
          <AgreementsSummaryCard companyId={cockpit.company.id} companyName={cockpit.company.name} />
          <OppDrill
            rows={(oppRows.data?.items ?? []).filter((o) => (o.customer ?? '').toLowerCase() === cockpit.company.name.toLowerCase())}
            filter={drill}
            onFilterChange={setDrill}
            onClose={() => setDrill(null)}
            rootLabel={cockpit.company.name}
          />
        </>
      ) : null}
      {isAccountView ? (
        <AccountDetailsFold label={t('dashboard.accountDetails', 'Account details')}>{cockpitBody}</AccountDetailsFold>
      ) : (
        cockpitBody
      )}
    </>
  );
}
