import { useState, useMemo, useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { computeBidComposite } from '@bidstack/shared';

import { GlassCard } from '@/components/ui/GlassCard';
import { Reveal } from '@/components/motion/Reveal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  useBidScoreLatest,
  useCreateBidScore,
  useAICalibrate,
  useBidScoreDefend,
} from '@/hooks/useBidScore';
import { useOpportunities } from '@/hooks/useOpportunities';

import type { ScoreValue, Scores } from './bidNoBid/bidNoBidTypes';
import { CRITERIA, getRecommendation } from './bidNoBid/bidNoBidTypes';
import { CriterionCard } from './bidNoBid/CriterionCard';
import { OverrideDialog } from './bidNoBid/OverrideDialog';
import { ScoreSummaryStrip } from './bidNoBid/ScoreSummaryStrip';

export function BidNoBidPage() {
  useDocumentTitle();
  const reduced = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();
  const opportunityId = searchParams.get('opportunityId') ?? undefined;
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
  const { totalScore, categoryScores, recommendationValue, ratedCount } = useMemo(() => {
    const composite = computeBidComposite(scores);
    return {
      totalScore: composite.totalScore,
      categoryScores: composite.categoryScores,
      recommendationValue: composite.recommendation,
      ratedCount: CRITERIA.filter((c) => (scores[c.id] ?? 0) > 0).length,
    };
  }, [scores]);

  const recommendation = getRecommendation(totalScore);

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
    (createScore.isError && 'Could not save the score. Try again.') ||
    (aiCalibrate.isError && 'AI calibration failed. Try again.') ||
    (defendScore.isError && 'Could not generate the score defense. Try again.') ||
    null;

  return (
    <>
      <div className="motion-page-head page-head">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title">Bid/No-Bid Decision Matrix</h1>
            {latestScore?.overrideJustification ? (
              <Tooltip content={latestScore.overrideJustification}>
                <span tabIndex={0} className="inline-flex cursor-help rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]">
                  <Badge
                    tone="amber"
                    className="px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider"
                  >
                    Override on record
                  </Badge>
                </span>
              </Tooltip>
            ) : null}
          </div>
          <p className="page-sub">
            Score each criterion to get an AI-powered go/no-go recommendation.
            {ratedCount > 0 && ` ${ratedCount}/${CRITERIA.length} criteria rated.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {opportunityId && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAICalibrate}
                disabled={aiCalibrate.isPending}
                aria-label="AI calibrate scores"
              >
                {aiCalibrate.isPending ? 'Calibrating…' : 'AI Calibrate'}
              </Button>
              {latestScore && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDefend}
                  disabled={defendScore.isPending}
                  aria-label="Defend score with AI"
                >
                  {defendScore.isPending ? 'Analyzing…' : 'Defend Score'}
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={createScore.isPending || ratedCount === 0}
                aria-label="Save bid score"
              >
                {createScore.isPending ? 'Saving…' : 'Save Score'}
              </Button>
            </>
          )}
        </div>
      </div>

      {actionError ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-[var(--color-danger,#dc2626)] bg-[color-mix(in_srgb,var(--color-danger,#dc2626)_10%,transparent)] px-4 py-3 text-sm text-[var(--color-danger,#dc2626)]"
        >
          {actionError}
        </div>
      ) : null}

      {/* Opportunity Selector */}
      <GlassCard className="mb-4">
        <label className="text-sm font-medium text-fg-secondary block mb-2">Opportunity</label>
        <select
          className="dialog-input w-full"
          value={opportunityId ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            if (id) {
              setSearchParams({ opportunityId: id });
            } else {
              setSearchParams({});
            }
          }}
          aria-label="Select opportunity"
          disabled={oppsLoading || oppsError}
        >
          <option value="">
            {oppsLoading
              ? 'Loading opportunities…'
              : oppsError
                ? 'Could not load opportunities'
                : '— Select an opportunity —'}
          </option>
          {opps?.items.map((o) => (
            <option key={o.id} value={o.id}>
              {o.customer} — {o.name} ({o.stage})
            </option>
          ))}
        </select>
        {oppsError ? (
          <p className="text-xs text-[var(--color-danger,#dc2626)] mt-2" role="alert">
            Opportunities failed to load. Refresh to try again.
          </p>
        ) : !opportunityId ? (
          <p className="text-xs text-fg-tertiary mt-2">
            Select an opportunity to enable saving and AI calibration.
          </p>
        ) : null}
      </GlassCard>

      <ScoreSummaryStrip
        totalScore={totalScore}
        recommendation={recommendation}
        categoryScores={categoryScores}
        ratedCount={ratedCount}
      />

      {/* Criteria Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <AnimatePresence mode="sync">
          {CRITERIA.map((criterion, i) => (
            <CriterionCard
              key={criterion.id}
              criterion={criterion}
              currentScore={scores[criterion.id] ?? 0}
              onScore={handleScore}
              reduced={reduced}
              delay={reduced ? 0 : i * 0.03}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* AI Defense Panel */}
      {defenseReasoning && (
        <Reveal>
          <GlassCard padding="lg" className="mb-6 border-l-4 border-l-brand-primary">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="sparkle" size={16} className="text-brand-primary" />
              <h2 className="text-sm font-semibold text-fg-primary">AI Score Defense</h2>
            </div>
            <p className="text-sm text-fg-secondary leading-relaxed whitespace-pre-wrap">
              {defenseReasoning}
            </p>
          </GlassCard>
        </Reveal>
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

      {/* Notes Section */}
      <Reveal delay={0.2}>
        <GlassCard padding="lg" className="mb-8">
          <h2 className="text-sm font-semibold text-fg-primary mb-2">Decision Notes</h2>
          <textarea
            className="dialog-input min-h-[100px] resize-y"
            placeholder="Add rationale, key concerns, or conditions for bidding…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Bid decision notes"
          />
        </GlassCard>
      </Reveal>
    </>
  );
}
