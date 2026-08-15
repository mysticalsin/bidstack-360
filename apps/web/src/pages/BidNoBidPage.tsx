// Bid/No-Bid decision matrix — the product's signature screen.
//
// ROUND2-ULTRAPLAN, "the density retarget": this page used to be a md:grid-cols-2
// card grid under a GlassCard of ProgressRings. It is now an instrument panel
// (ScoreInstrumentPanel), a segmented category readout/filter, and one dense
// table of the ten weighted criteria — every view of it addressable by URL.
//
// SCORING LOGIC IS UNCHANGED. computeBidComposite still owns the arithmetic,
// the API contract is untouched, and the save/override/calibrate/defend paths
// below are the same code they were. This is a presentation change.
//
// ── "NO BLANK FRAME AFTER FIRST PAINT" ──────────────────────────────────────
// The rows derive from the criteria registry in @bidstack/shared, not from a
// fetch, so the table is fully painted on the first frame and a category or sort
// change re-orders rows already in the DOM — there is no request to be pending
// and no state in which the body is empty. The two async reads on this page (the
// opportunity list, the latest saved score) feed controls that carry their own
// loading/error copy and never blank the matrix.
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryState } from 'nuqs';
import { computeBidComposite } from '@bidstack/shared';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { useHasPermission } from '@/hooks/useCapabilities';
import {
  useBidScoreLatest,
  useCreateBidScore,
  useAICalibrate,
  useBidScoreDefend,
} from '@/hooks/useBidScore';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useTableQuery } from '@/lib/table/use-table-query';

import type { ScoreValue, Scores } from './bidNoBid/bidNoBidTypes';
import { CRITERIA, getRecommendation, visibleCriteria } from './bidNoBid/bidNoBidTypes';
import {
  OPPORTUNITY_ID_KEY,
  bidNoBidSearchParams,
  opportunityIdParser,
} from './bidNoBid/bid-no-bid-search-params';
import { BidClassificationPanel } from './bidNoBid/BidClassificationPanel';
import { CriteriaCategoryFilter } from './bidNoBid/CriteriaCategoryFilter';
import { CriteriaTable } from './bidNoBid/CriteriaTable';
import { OverrideDialog } from './bidNoBid/OverrideDialog';
import { ScoreInstrumentPanel } from './bidNoBid/ScoreInstrumentPanel';

// One bordered surface, reused by the three secondary panels so the page reads
// as a stack of instruments rather than a pile of differently-shaped cards.
const PANEL = 'rounded-lg border border-border-subtle bg-surface-card p-4';

export function BidNoBidPage() {
  const { t } = useTranslation('crm');
  useDocumentTitle();

  // nuqs, not useSearchParams: url-param-audit.md §2 records this page's two
  // object-form writes as destructive, and now that `category`/`sort` share the
  // query string they would be wiped on every opportunity change. nuqs merges.
  const [opportunityIdValue, setOpportunityId] = useQueryState(
    OPPORTUNITY_ID_KEY,
    opportunityIdParser,
  );
  const opportunityId = opportunityIdValue || undefined;
  const { query } = useTableQuery(bidNoBidSearchParams);

  // Save/AI-calibrate/defend all persist through POST /api/v1/bid-scores* which
  // is gated server-side behind bid-scores:write — hide the actions instead of
  // letting a read-only role 403 on click.
  const canWrite = useHasPermission('bid-scores:write');

  const [scores, setScores] = useState<Scores>({});
  const [notes, setNotes] = useState('');
  const [defenseReasoning, setDefenseReasoning] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const { data: latestScore } = useBidScoreLatest(opportunityId);
  const createScore = useCreateBidScore();
  const aiCalibrate = useAICalibrate();
  const defendScore = useBidScoreDefend();
  const { data: opps, isLoading: oppsLoading, isError: oppsError } = useOpportunities({ limit: 50 });

  /* eslint-disable react-hooks/set-state-in-effect */
  // Synchronize editable form state when the fetched score changes.
  // This is intentional: scores/notes are user-editable drafts that must reset
  // to the latest persisted values when the opportunity or score changes.
  useEffect(() => {
    if (latestScore?.criteria) {
      setScores(latestScore.criteria as Scores);
      if (latestScore.notes) setNotes(latestScore.notes);
    }
  }, [latestScore]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const saveScore = useCallback(
    (decision: 'follow' | 'override', justification?: string) => {
      if (!opportunityId) return;
      createScore.mutate(
        {
          opportunityId,
          criteria: scores,
          notes: notes || undefined,
          decision,
          ...(decision === 'override' && justification
            ? { override: { acknowledged: true as const, justification } }
            : {}),
        },
        { onSuccess: () => setOverrideOpen(false) },
      );
    },
    [opportunityId, scores, notes, createScore],
  );

  const handleAICalibrate = useCallback(() => {
    if (!opportunityId) return;
    setDefenseReasoning(null);
    aiCalibrate.mutate(opportunityId, {
      onSuccess: (data) => {
        setScores(data.criteria as Scores);
      },
    });
  }, [opportunityId, aiCalibrate]);

  const handleDefend = useCallback(() => {
    if (!latestScore?.id) return;
    setDefenseReasoning(null);
    defendScore.mutate(latestScore.id, {
      onSuccess: (data) => {
        setDefenseReasoning(data.reasoning);
      },
    });
  }, [latestScore, defendScore]);

  const handleScore = useCallback((criterionId: string, value: ScoreValue) => {
    setScores((prev) => ({ ...prev, [criterionId]: value }));
  }, []);

  // Shared composite math — same module the API persists with, so the live
  // total always matches the saved total (full-weight divisor, one threshold
  // table). Unrated criteria count as 0 rather than being excluded.
  const { totalScore, categoryScores, recommendationValue, ratedCount, ratedWeight } = useMemo(() => {
    const composite = computeBidComposite(scores);
    const rated = CRITERIA.filter((c) => (scores[c.id] ?? 0) > 0);
    return {
      totalScore: composite.totalScore,
      categoryScores: composite.categoryScores,
      recommendationValue: composite.recommendation,
      ratedCount: rated.length,
      ratedWeight: rated.reduce((sum, c) => sum + c.weight, 0),
    };
  }, [scores]);

  const recommendation = getRecommendation(totalScore);

  // The URL is the single source of truth for which rows are on screen and in
  // what order — paste the address bar anywhere and the same matrix appears.
  const rows = useMemo(
    () => visibleCriteria({ category: query.tab, sort: query.sort, dir: query.dir, scores }),
    [query.tab, query.sort, query.dir, scores],
  );

  const handleSave = useCallback(() => {
    if (!opportunityId || ratedCount === 0) return;
    if (recommendationValue === 'bid') {
      saveScore('follow');
    } else {
      // Below threshold: the user must explicitly follow or override (with
      // a mandatory justification) before anything is persisted.
      setOverrideOpen(true);
    }
  }, [opportunityId, ratedCount, recommendationValue, saveScore]);

  // Surface mutation failures — previously Save Score / AI Calibrate / Defend
  // rejected silently, so a failed save looked identical to a successful one.
  const actionError =
    (createScore.isError && t('bidNoBid.error.saveScore', 'Could not save the score. Try again.')) ||
    (aiCalibrate.isError && t('bidNoBid.error.aiCalibrate', 'AI calibration failed. Try again.')) ||
    (defendScore.isError &&
      t('bidNoBid.error.defend', 'Could not generate the score defense. Try again.')) ||
    null;

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {t('bidNoBid.title', 'Bid/No-Bid Decision Matrix')}
            {latestScore?.overrideJustification ? (
              <Tooltip content={latestScore.overrideJustification}>
                <span
                  tabIndex={0}
                  className="inline-flex cursor-help rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                >
                  <Badge
                    tone="amber"
                    className="px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider"
                  >
                    {t('bidNoBid.overrideBadge', 'Override on record')}
                  </Badge>
                </span>
              </Tooltip>
            ) : null}
          </span>
        }
        description={
          <>
            {t(
              'bidNoBid.subtitle',
              'Score each criterion to get an AI-powered go/no-go recommendation.',
            )}
            {ratedCount > 0 &&
              ` ${t('bidNoBid.criteriaRated', '{{rated}}/{{total}} criteria rated.', {
                rated: ratedCount,
                total: CRITERIA.length,
              })}`}
          </>
        }
        actions={
          opportunityId && canWrite ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAICalibrate}
                disabled={aiCalibrate.isPending}
                aria-label={t('bidNoBid.aiCalibrate.aria', 'AI calibrate scores')}
              >
                {aiCalibrate.isPending
                  ? t('bidNoBid.aiCalibrate.pending', 'Calibrating…')
                  : t('bidNoBid.aiCalibrate.label', 'AI Calibrate')}
              </Button>
              {latestScore && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDefend}
                  disabled={defendScore.isPending}
                  aria-label={t('bidNoBid.defend.aria', 'Defend score with AI')}
                >
                  {defendScore.isPending
                    ? t('bidNoBid.defend.pending', 'Analyzing…')
                    : t('bidNoBid.defend.label', 'Defend Score')}
                </Button>
              )}
              {/* The one brand accent on this screen. Everything below it is
                  neutral or semantic — see the colour note in CriteriaTable. */}
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={createScore.isPending || ratedCount === 0}
                aria-label={t('bidNoBid.save.aria', 'Save bid score')}
              >
                {createScore.isPending
                  ? t('bidNoBid.save.pending', 'Saving…')
                  : t('bidNoBid.save.label', 'Save Score')}
              </Button>
            </>
          ) : null
        }
      />

      {actionError ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-[var(--color-danger,#dc2626)] bg-[color-mix(in_srgb,var(--color-danger,#dc2626)_10%,transparent)] px-4 py-3 text-sm text-[var(--color-danger,#dc2626)]"
        >
          {actionError}
        </div>
      ) : null}

      <div className={`${PANEL} mb-4 flex flex-wrap items-center gap-x-4 gap-y-2`}>
        <label
          htmlFor="bid-no-bid-opportunity"
          className="shrink-0 text-xs font-medium text-fg-secondary"
        >
          {t('bidNoBid.opportunity.label', 'Opportunity')}
        </label>
        <select
          id="bid-no-bid-opportunity"
          className="dialog-input h-8 min-w-0 flex-1 text-xs"
          value={opportunityId ?? ''}
          // A nuqs write, so `category` / `sort` survive a change of subject.
          onChange={(e) => void setOpportunityId(e.target.value || null)}
          aria-label={t('bidNoBid.opportunity.aria', 'Select opportunity')}
          disabled={oppsLoading || oppsError}
        >
          <option value="">
            {oppsLoading
              ? t('bidNoBid.opportunity.loading', 'Loading opportunities…')
              : oppsError
                ? t('bidNoBid.opportunity.loadError', 'Could not load opportunities')
                : t('bidNoBid.opportunity.placeholder', '— Select an opportunity —')}
          </option>
          {opps?.items.map((o) => (
            <option key={o.id} value={o.id}>
              {o.customer} — {o.name} ({o.stage})
            </option>
          ))}
        </select>
        {oppsError ? (
          <p className="w-full text-xs text-[var(--danger)]" role="alert">
            {t(
              'bidNoBid.opportunity.loadFailed',
              'Opportunities failed to load. Refresh to try again.',
            )}
          </p>
        ) : !opportunityId ? (
          <p className="w-full text-xs text-fg-tertiary">
            {t(
              'bidNoBid.opportunity.hint',
              'Select an opportunity to enable saving and AI calibration.',
            )}
          </p>
        ) : null}
      </div>

      <ScoreInstrumentPanel
        totalScore={totalScore}
        savedScore={latestScore?.totalScore ?? null}
        recommendation={recommendation}
        ratedCount={ratedCount}
        ratedWeight={ratedWeight}
        criteriaCount={CRITERIA.length}
      />

      <CriteriaCategoryFilter
        value={query.tab}
        onChange={query.setTab}
        totalScore={totalScore}
        categoryScores={categoryScores}
      />

      <CriteriaTable
        criteria={rows}
        scores={scores}
        onScore={handleScore}
        sort={query.sort}
        dir={query.dir}
        onToggleSort={query.toggleSort}
      />

      {defenseReasoning && (
        <div className={`${PANEL} mb-6`}>
          <div className="mb-2 flex items-center gap-2">
            <Icon name="sparkle" size={16} className="text-brand-primary" />
            <h2 className="text-sm font-semibold text-fg-primary">
              {t('bidNoBid.defensePanel.title', 'AI Score Defense')}
            </h2>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
            {defenseReasoning}
          </p>
        </div>
      )}

      <OverrideDialog
        open={overrideOpen}
        verdict={recommendation.verdict}
        totalScore={totalScore}
        pending={createScore.isPending}
        onOpenChange={setOverrideOpen}
        onFollow={() => saveScore('follow')}
        onOverride={(justification) => saveScore('override', justification)}
      />

      <BidClassificationPanel />

      <div className={`${PANEL} mb-8`}>
        <h2 className="mb-2 text-sm font-semibold text-fg-primary">
          {t('bidNoBid.notes.title', 'Decision Notes')}
        </h2>
        <textarea
          className="dialog-input min-h-[100px] w-full resize-y"
          placeholder={t(
            'bidNoBid.notes.placeholder',
            'Add rationale, key concerns, or conditions for bidding…',
          )}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label={t('bidNoBid.notes.aria', 'Bid decision notes')}
        />
      </div>
    </>
  );
}
