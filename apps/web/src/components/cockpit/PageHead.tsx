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
import { useOpportunities } from '@/hooks/useOpportunities';
import { formatDate } from '@/lib/format';
import { springSoft } from '@/lib/motion';
import { useAccountHistory } from '@/stores/accountHistory';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { deriveNextMove } from './CommandCenter';
import { labelForBand } from './_tokens';

interface Props {
  cockpit: AccountCockpitSnapshot;
  accountView: boolean;
}

export const PageHead = memo(function PageHead({ cockpit, accountView }: Props) {
  const { t } = useTranslation('crm');
  const [briefOpen, setBriefOpen] = useState(false);
  const enrich = useEnrichCompany();
  const reducedMotion = useReducedMotion();
  // We use the most recent opportunity for this customer as the brief target.
  // Briefs are scoped to a deal (the API endpoint is /opportunities/:id/brief)
  // — if no deal exists yet, the button stays disabled with a helpful tooltip.
  const opps = useOpportunities({ limit: 50 });
  const linkedOpp = opps.data?.items.find(
    (o) => o.customer.toLowerCase() === cockpit.company.name.toLowerCase(),
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
  const { formatMoney } = useFormatMoney();
  const accountOpps = (opps.data?.items ?? []).filter(
    (o) => o.customer.toLowerCase() === cockpit.company.name.toLowerCase(),
  );
  const openOpps = accountOpps.filter((o) => o.stage !== 'closed_won' && o.stage !== 'closed_lost');
  const openValue = openOpps.reduce((sum, o) => sum + o.value, 0);
  const openRisks = cockpit.risks.filter((r) => r.status !== 'mitigated');
  const highRisks = openRisks.filter((r) => r.severity === 'critical' || r.severity === 'high').length;
  const winLoss = cockpit.winLoss;
  const nextMove = deriveNextMove(cockpit, t);
  const closedCount = winLoss ? winLoss.wonCount + winLoss.lostCount : 0;

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
              <span className="acct-pill" data-band={cockpit.health.band}>
                {labelForBand(cockpit.health.band)}
              </span>
              <span className="acct-health-text" title={nextMove}>{nextMove}</span>
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
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setBriefOpen(true)}
            title={t('pageHead.generateBriefTitle', 'Generate brief for {{name}}', {
              name: linkedOpp.name,
            })}
          >
            <Icon name="sparkle" size={14} />
            {t('pageHead.generateBrief', 'Generate brief')}
          </button>
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
        <dl className="acct-keys" aria-label={t('pageHead.keyNumbers', 'Key numbers')}>
          <div>
            <dt>{t('pageHead.keyOpenPipeline', 'Open pipeline')}</dt>
            <dd>{formatMoney(openValue)}</dd>
            <span>
              {openOpps.length === 1
                ? t('pageHead.keyOpenDeal', '1 open deal')
                : t('pageHead.keyOpenDeals', '{{count}} open deals', { count: openOpps.length })}
            </span>
          </div>
          <div>
            <dt>{t('pageHead.keyWinRate', 'Win rate')}</dt>
            <dd>{winLoss && closedCount > 0 ? `${winLoss.winRate}%` : '—'}</dd>
            <span>
              {winLoss && closedCount > 0
                ? t('pageHead.keyWonOf', '{{won}} of {{total}} closed', {
                    won: winLoss.wonCount,
                    total: closedCount,
                  })
                : t('pageHead.keyNoClosed', 'No closed bids yet')}
            </span>
          </div>
          <div>
            <dt>{t('pageHead.keyOpenRisks', 'Open risks')}</dt>
            <dd>{openRisks.length}</dd>
            <span>
              {highRisks > 0
                ? t('pageHead.keyHighRisks', '{{count}} high', { count: highRisks })
                : t('pageHead.keyNoHighRisks', 'None high')}
            </span>
          </div>
        </dl>
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
        {t('pageHead.briefConfidence', 'Confidence: {{percent}}%', {
          percent: Math.round(c.confidence * 100),
        })}
      </div>
    </div>
  );
}
