import { motion, useReducedMotion } from 'framer-motion';
import { Fragment, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { CompanyLogo } from '@/components/company/CompanyLogo';
import { displayableLogoUrl } from '@/components/company/logoUrlSafety';
import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { BriefingDialog } from '@/components/opportunity/BriefingDialog';
import { Icon } from '@/components/ui/Icon';
import { SavedFlash } from '@/components/ui/SavedFlash';
import { useEnrichCompany } from '@/hooks/useEnrichCompany';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { Spark } from '@/components/viz/charts';
import { microsToUnits } from '@bidstack/shared';

import { recordedMicros } from '@/components/dashboard/unspecified-currency';
import { cumulativeOpen, runningWinRate } from '@/components/viz/viz-data';
import { AnimatedNumber } from '@/components/motion-primitives/animated-number';
import { MetricSpark } from '@/components/viz/lazy-bklit';
import { PulseOrb, toneForBand } from '@/components/viz/PulseOrb';
import CommandButton from '@/components/kokonutui/command-button';
import { useOpportunities } from '@/hooks/useOpportunities';
import { formatDate } from '@/lib/format';
import { closedOutcome } from '@/lib/pipeline-stages';
import { springSoft } from '@/lib/motion';
import { useAccountHistory } from '@/stores/accountHistory';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { deriveNextMove } from './CommandCenter';
import { openRiskHeadline, openRiskSparkLabel } from './open-risk-headline';
import { labelForBand } from './_tokens';

const ACCOUNT_HEAD_OPP_LIMIT = 50;

/** A customer string is not a company link. Only the stored company id is. */
export function opportunityBelongsToCompany(
  opportunity: { companyId?: string | null },
  companyId: string,
): boolean {
  return opportunity.companyId === companyId;
}

/** Open-deal count on the account header. A continuing page is not the account total. */
export function openDealCountLabel(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return count === 1
      ? `1 open deal in the latest ${ACCOUNT_HEAD_OPP_LIMIT} bids`
      : `${count} open deals in the latest ${ACCOUNT_HEAD_OPP_LIMIT} bids`;
  }
  return count === 1 ? '1 open deal' : `${count} open deals`;
}

interface Props {
  cockpit: AccountCockpitSnapshot;
  accountView: boolean;
  /** Account view: open the bid drill for this account ('open' or closed 'won'/'lost' = all closed). */
  onDrill?: (status: 'open' | 'all') => void;
}

export const PageHead = memo(function PageHead({ cockpit, accountView, onDrill }: Props) {
  const { t } = useTranslation('crm');
  const [briefOpen, setBriefOpen] = useState(false);
  const enrich = useEnrichCompany();
  const reducedMotion = useReducedMotion();
  // We use the most recent opportunity for this customer as the brief target.
  // Briefs are scoped to a deal (the API endpoint is /opportunities/:id/brief)
  // — if no deal exists yet, the button stays disabled with a helpful tooltip.
  const opps = useOpportunities({ limit: ACCOUNT_HEAD_OPP_LIMIT });
  const linkedOpp = opps.data?.items.find((o) =>
    opportunityBelongsToCompany(o, cockpit.company.id),
  );

  // Pulse a "Saved" chip whenever data verification finishes. Tracking a counter
  // lets the SavedFlash component re-trigger on each completion, even when
  // the user enriches the same company multiple times in a session.
  const [enrichSavedAt, setEnrichSavedAt] = useState(0);
  const handleEnrich = () => {
    enrich.mutate(
      {
        id: cockpit.company.id,
        name: cockpit.company.name,
        ...(cockpit.company.domain ? { domain: cockpit.company.domain } : {}),
        ...(cockpit.company.website ? { website: cockpit.company.website } : {}),
      },
      {
        onSuccess: () => setEnrichSavedAt((n) => n + 1),
      },
    );
  };

  // Star / favorite. Only meaningful on the account view (the /dashboard
  // org view doesn't map to a single account). Subscribing to the favorites
  // array — not isFavorite — re-renders the button when toggled elsewhere
  // (e.g. via the sidebar).
  const { accountId } = useParams<{ accountId?: string }>();
  const favorites = useAccountHistory((s) => s.favorites);
  const toggleFavorite = useAccountHistory((s) => s.toggleFavorite);
  const isStarred = accountId ? favorites.some((f) => f.slug === accountId) : false;
  const subtitle = t('pageHead.dashboardSubtitle', 'Today: {{date}} - {{company}} cockpit', {
    date: formatDate(new Date().toISOString()),
    company: cockpit.company.name,
  });
  const { formatMoneyMicros } = useFormatMoney();
  const accountOpps = (opps.data?.items ?? []).filter((o) =>
    opportunityBelongsToCompany(o, cockpit.company.id),
  );
  const oppPageContinues = Boolean(opps.data?.nextCursor);
  const openOpps = accountOpps.filter((o) => closedOutcome(o) === null);
  const openMicros = openOpps.reduce((sum, o) => sum + recordedMicros(o.value, o.valueMicros), 0n);
  const riskHeadline = openRiskHeadline(cockpit);
  const highRisks = riskHeadline.high;
  const winLoss = cockpit.winLoss;
  const nextMove = deriveNextMove(cockpit, t);
  const closedCount = winLoss ? winLoss.wonCount + winLoss.lostCount : 0;
  // Sparklines (real rows only): open value accumulated by due date, running
  // win rate across closed bids in close order, open risks by severity.
  const sparkRows = accountOpps.map((o) => ({ id: o.id, stage: o.stage, value: microsToUnits(recordedMicros(o.value, o.valueMicros)), dueDate: o.dueDate ?? null, closedAt: o.closedAt ?? null, customer: o.customer, pipelineStage: o.pipelineStage, valueMicros: o.valueMicros }));
  const openSpark = cumulativeOpen(sparkRows);
  const winSpark = runningWinRate(sparkRows);
  const riskSpark = riskHeadline.spark;

  return (
    <motion.div
      className={`page-head motion-page-head cockpit-page-head${accountView ? ' acct-head' : ''}`}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(6px)' }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={springSoft}
    >
      <div
        className="account-heading-cluster"
        style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}
      >
        <CompanyLogo
          name={cockpit.company.name}
          companyId={cockpit.company.id}
          logo={cockpit.company.logo}
          domain={cockpit.company.domain}
          size={accountView ? 40 : 52}
          priority
          brief={<CompanyBrief cockpit={cockpit} />}
        />
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">
            {accountView ? cockpit.company.name : t('pageHead.dashboardTitle', 'Dashboard')}
          </h1>
          {accountView ? null : <div className="page-sub">{subtitle}</div>}
          {accountView ? (
            <p className="acct-health" aria-label={t('pageHead.accountStatusSummaryLabel', 'Account status summary')}>
              <PulseOrb tone={toneForBand(cockpit.health.band)} size={48} bold />
              <span className="acct-health-body">
                <span className="acct-health-tags">
                  <span className="acct-pill" data-band={cockpit.health.band}>
                    {labelForBand(cockpit.health.band)}
                  </span>
                  {cockpit.company.domain ? <span className="acct-domain">{cockpit.company.domain}</span> : null}
                </span>
                <span className="acct-health-text" title={nextMove}>{nextMove}</span>
              </span>
            </p>
          ) : null}
        </div>
      </div>
      <div className="page-actions">
        {accountView && accountId ? (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => toggleFavorite(accountId, cockpit.company.name)}
            aria-pressed={isStarred}
            title={
              isStarred
                ? t('pageHead.removeFromFavorites', 'Remove from favorites')
                : t('pageHead.addToFavorites', 'Add to favorites')
            }
            style={{ color: isStarred ? 'var(--warning)' : undefined }}
          >
            <Icon name={isStarred ? 'starFilled' : 'star'} size={14} />
            {isStarred ? t('pageHead.starred', 'Starred') : t('pageHead.star', 'Star')}
          </button>
        ) : null}
        <button
          type="button"
          className={accountView ? 'btn btn-quiet' : 'btn btn-secondary'}
          onClick={handleEnrich}
          disabled={enrich.isPending}
          title={t('pageHead.enrichTitle', 'Refresh available data sources')}
        >
          {enrich.isPending ? (
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
              aria-hidden
            />
          ) : (
            <Icon name="download" size={14} />
          )}
          {enrich.isPending
            ? t('pageHead.enriching', 'Enriching…')
            : t('pageHead.enrichNow', 'Enrich now')}
          <SavedFlash trigger={enrichSavedAt} />
        </button>
        {accountView ? (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => window.print()}
            title={t('pageHead.printTitle', 'Print the cockpit as a one-page brief')}
          >
            <Icon name="print" size={14} />
            {t('pageHead.print', 'Print')}
          </button>
        ) : null}
        {linkedOpp ? (
          <CommandButton
            tone="primary"
            shortcut="shift+b"
            onClick={() => setBriefOpen(true)}
            title={t('pageHead.generateBriefTitle', 'Generate brief for {{name}} (Shift+B)', {
              name: linkedOpp.name,
            })}
          >
            <Icon name="sparkle" size={14} />
            {t('pageHead.generateBrief', 'Generate brief')}
          </CommandButton>
        ) : accountView ? (
          <CreateOpportunityDialog
            defaultCustomer={cockpit.company.name}
            trigger={
              <button
                type="button"
                className="btn btn-primary"
                title={t('pageHead.createOpportunityTitle', 'Create an opportunity for {{name}}', {
                  name: cockpit.company.name,
                })}
              >
                <Icon name="plus" size={14} />
                {t('pageHead.createOpportunity', 'Create opportunity')}
              </button>
            }
          />
        ) : null}
      </div>

      {accountView ? (
        <div className="acct-keys" role="group" aria-label={t('pageHead.keyNumbers', 'Key numbers')}>
          <div>
            <span className="acct-key-label">{t('pageHead.keyOpenPipeline', 'Open pipeline')}</span>
            <span className="acct-key-value">{formatMoneyMicros(openMicros)}</span>
            <MetricSpark values={openSpark} label={t('pageHead.sparkOpen', 'Open value building up by due date')} />
            <span>
              {t(
                oppPageContinues
                  ? openOpps.length === 1
                    ? 'pageHead.keyOpenDealPage'
                    : 'pageHead.keyOpenDealsPage'
                  : openOpps.length === 1
                    ? 'pageHead.keyOpenDeal'
                    : 'pageHead.keyOpenDeals',
                openDealCountLabel(openOpps.length, oppPageContinues),
                { count: openOpps.length },
              )}
            </span>
            {onDrill ? <button type="button" className="drill-more acct-key-drill" onClick={() => onDrill('open')}>{t('pageHead.showOpenBids', 'Show open bids')}</button> : null}
          </div>
          <div>
            <span className="acct-key-label">{t('pageHead.keyWinRate', 'Win rate')}</span>
            <span className="acct-key-value">{winLoss && closedCount > 0 ? <AnimatedNumber value={winLoss.winRate} format={(n) => `${Math.round(n)}%`} /> : '—'}</span>
            <MetricSpark values={winSpark} label={t('pageHead.sparkWin', 'Running win rate after each closed bid')} />
            <span>
              {winLoss && closedCount > 0
                ? t('pageHead.keyWonOf', '{{won}} of {{total}} closed', {
                    won: winLoss.wonCount,
                    total: closedCount,
                  })
                : t('pageHead.keyNoClosed', 'No closed bids yet')}
            </span>
            {onDrill && closedCount > 0 ? <button type="button" className="drill-more acct-key-drill" onClick={() => onDrill('all')}>{t('pageHead.showAllBids', 'Show won and lost')}</button> : null}
          </div>
          <div>
            <span className="acct-key-label">{t('pageHead.keyOpenRisks', 'Open risks')}</span>
            <span className="acct-key-value">{riskHeadline.total}</span>
            {riskHeadline.total > 0 ? (
              <Spark
                mode="bars"
                values={riskSpark}
                hotFrom={2}
                width={48}
                label={t(
                  riskHeadline.unranked > 0 ? 'pageHead.sparkRiskUnranked' : 'pageHead.sparkRisk',
                  openRiskSparkLabel(riskHeadline),
                  {
                    low: riskSpark[0],
                    med: riskSpark[1],
                    high: riskSpark[2],
                    crit: riskSpark[3],
                    unranked: riskHeadline.unranked,
                  },
                )}
              />
            ) : null}
            <span>
              {highRisks > 0
                ? t('pageHead.keyHighRisks', '{{count}} high', { count: highRisks })
                : t('pageHead.keyNoHighRisks', 'None high')}
            </span>
          </div>
        </div>
      ) : null}

      {linkedOpp ? (
        <BriefingDialog
          opportunityId={linkedOpp.id}
          opportunityLabel={linkedOpp.name}
          open={briefOpen}
          onOpenChange={setBriefOpen}
        />
      ) : null}
    </motion.div>
  );
});

// Compact data brief shown when hovering the company logo. Picks
// from whichever fields the CRM data verification surfaced; nullable fields are
// quietly skipped rather than rendered as "Unknown" placeholders.
function CompanyBrief({ cockpit }: { cockpit: AccountCockpitSnapshot }) {
  const { t } = useTranslation('crm');
  const c = cockpit.company;
  const imageUrl = displayableLogoUrl(c.imageUrl);
  const rows: Array<[string, string]> = [];
  if (c.industry) rows.push([t('pageHead.briefIndustry', 'Industry'), c.industry]);
  if (c.employeeCount)
    rows.push([t('pageHead.briefHeadcount', 'Headcount'), c.employeeCount.toLocaleString()]);
  if (c.publicFacts?.headquarters)
    rows.push([t('pageHead.briefHeadquarters', 'Headquarters'), c.publicFacts.headquarters]);
  if (c.publicFacts?.revenueLabel)
    rows.push([t('pageHead.briefRevenue', 'Revenue'), c.publicFacts.revenueLabel]);
  if (c.publicFacts?.chiefExecutive)
    rows.push([t('pageHead.briefChiefExecutive', 'Chief executive'), c.publicFacts.chiefExecutive]);
  if (c.domain) rows.push([t('pageHead.briefDomain', 'Domain'), c.domain]);
  if (c.legalName && c.legalName !== c.name)
    rows.push([t('pageHead.briefLegalName', 'Legal name'), c.legalName]);
  if (c.incorporationDate)
    rows.push([t('pageHead.briefFounded', 'Founded'), c.incorporationDate.slice(0, 4)]);
  return (
    <div>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="mb-3 h-24 w-full rounded-md border border-[var(--border-default)] object-cover"
        />
      ) : null}
      <div className="text-sm font-semibold text-[var(--fg-primary)]">{c.name}</div>
      {c.website ? (
        <a
          href={c.website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--brand-primary)] hover:underline"
        >
          {c.website.replace(/^https?:\/\//, '')}
        </a>
      ) : null}
      {rows.length > 0 ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-[var(--fg-tertiary)]">{k}</dt>
              <dd className="text-[var(--fg-primary)]">{v}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      <div className="mt-3 text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
        {recordedConfidencePercent(c.confidence) === null
          ? t('pageHead.confidenceNotScored', 'Confidence not scored')
          : t('pageHead.briefConfidence', 'Confidence: {{percent}}%', {
              percent: recordedConfidencePercent(c.confidence),
            })}
      </div>
    </div>
  );
}
