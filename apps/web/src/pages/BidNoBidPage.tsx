import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { GlassCard } from '@/components/ui/GlassCard';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { StatusPulse } from '@/components/ui/StatusPulse';
import { Reveal } from '@/components/motion/Reveal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Icon } from '@/components/ui/Icon';

// --- Criterion definitions ---

interface Criterion {
  id: string;
  label: string;
  description: string;
  category: 'strategic' | 'technical' | 'commercial' | 'risk';
  weight: number;
  icon: string;
}

const CRITERIA: Criterion[] = [
  {
    id: 'fit',
    label: 'Strategic Fit',
    description:
      'How well does this opportunity align with our core capabilities and strategic direction?',
    category: 'strategic',
    weight: 15,
    icon: 'target',
  },
  {
    id: 'relationship',
    label: 'Client Relationship',
    description:
      'Strength of existing relationship with the client. Prior wins, references, and decision-unit access.',
    category: 'strategic',
    weight: 10,
    icon: 'contacts',
  },
  {
    id: 'competitive',
    label: 'Competitive Position',
    description:
      'Our differentiation vs known competitors. Are we the incumbent? Do we have technical edge?',
    category: 'strategic',
    weight: 12,
    icon: 'trophy',
  },
  {
    id: 'tech_capability',
    label: 'Technical Capability',
    description: 'Do we have the people, technology, and certifications to deliver?',
    category: 'technical',
    weight: 15,
    icon: 'settings',
  },
  {
    id: 'resource_avail',
    label: 'Resource Availability',
    description:
      'Are the required team members and subject-matter experts available for this timeline?',
    category: 'technical',
    weight: 10,
    icon: 'clock',
  },
  {
    id: 'solution_ready',
    label: 'Solution Readiness',
    description:
      'Level of maturity of our proposed solution. Proof-of-concept, prior delivery, or greenfield?',
    category: 'technical',
    weight: 8,
    icon: 'tasks',
  },
  {
    id: 'deal_size',
    label: 'Deal Size',
    description: 'Total contract value relative to our average deal size and revenue targets.',
    category: 'commercial',
    weight: 10,
    icon: 'dollar',
  },
  {
    id: 'margin_potential',
    label: 'Margin Potential',
    description: 'Expected profitability after delivery costs, partner fees, and risk provisions.',
    category: 'commercial',
    weight: 8,
    icon: 'growth',
  },
  {
    id: 'payment_terms',
    label: 'Payment Terms',
    description: 'Acceptable payment schedule, milestones, and cash-flow impact.',
    category: 'commercial',
    weight: 5,
    icon: 'briefcase',
  },
  {
    id: 'timeline_risk',
    label: 'Timeline Risk',
    description: 'Is the proposal deadline realistic? Can we produce a quality response?',
    category: 'risk',
    weight: 7,
    icon: 'warning',
  },
];

type ScoreValue = 0 | 1 | 2 | 3 | 4 | 5;
type Scores = Record<string, ScoreValue>;

const SCORE_LABELS: Record<ScoreValue, string> = {
  0: 'Not rated',
  1: 'Very Weak',
  2: 'Weak',
  3: 'Neutral',
  4: 'Strong',
  5: 'Very Strong',
};

const SCORE_COLORS: Record<ScoreValue, string> = {
  0: 'var(--fg-muted)',
  1: 'var(--danger)',
  2: 'var(--warning)',
  3: 'var(--fg-secondary)',
  4: 'var(--success)',
  5: 'var(--brand-primary)',
};

const CATEGORY_INFO: Record<string, { label: string; color: string }> = {
  strategic: { label: 'Strategic Alignment', color: 'var(--brand-primary)' },
  technical: { label: 'Technical Readiness', color: 'var(--info)' },
  commercial: { label: 'Commercial Viability', color: 'var(--success)' },
  risk: { label: 'Risk Assessment', color: 'var(--warning)' },
};

function getRecommendation(score: number): {
  verdict: string;
  color: string;
  status: 'success' | 'warning' | 'danger';
} {
  if (score >= 75)
    return { verdict: 'BID — Strong fit', color: 'var(--success)', status: 'success' };
  if (score >= 55)
    return {
      verdict: 'CONDITIONAL BID — Review risks',
      color: 'var(--warning)',
      status: 'warning',
    };
  return { verdict: 'NO-BID — Insufficient alignment', color: 'var(--danger)', status: 'danger' };
}

export function BidNoBidPage() {
  useDocumentTitle();
  const reduced = useReducedMotion();
  const [scores, setScores] = useState<Scores>({});
  const [notes, setNotes] = useState('');

  const handleScore = useCallback((criterionId: string, value: ScoreValue) => {
    setScores((prev) => ({ ...prev, [criterionId]: value }));
  }, []);

  const { totalScore, categoryScores, ratedCount } = useMemo(() => {
    let weightedSum = 0;
    let totalWeight = 0;
    const catMap: Record<string, { sum: number; weight: number }> = {};

    for (const c of CRITERIA) {
      const s = scores[c.id] ?? 0;
      if (s > 0) {
        const normalized = (s / 5) * c.weight;
        weightedSum += normalized;
        totalWeight += c.weight;
        if (!catMap[c.category]) catMap[c.category] = { sum: 0, weight: 0 };
        const entry = catMap[c.category];
        if (entry) {
          entry.sum += (s / 5) * 100;
          entry.weight += 1;
        }
      }
    }

    const total = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;
    const cats: Record<string, number> = {};
    for (const [cat, data] of Object.entries(catMap)) {
      cats[cat] = data.weight > 0 ? Math.round(data.sum / data.weight) : 0;
    }

    return {
      totalScore: total,
      categoryScores: cats,
      ratedCount: Object.values(scores).filter((v) => v > 0).length,
    };
  }, [scores]);

  const recommendation = getRecommendation(totalScore);

  return (
    <>
      <div className="motion-page-head page-head">
        <div>
          <h1 className="page-title">Bid/No-Bid Decision Matrix</h1>
          <p className="page-sub">
            Score each criterion to get an AI-powered go/no-go recommendation.
            {ratedCount > 0 && ` ${ratedCount}/${CRITERIA.length} criteria rated.`}
          </p>
        </div>
      </div>

      {/* Score Summary Strip */}
      <Reveal>
        <GlassCard className="mt-4 mb-6">
          <div className="flex flex-wrap items-center gap-8 p-5">
            {/* Overall Score Ring */}
            <div className="flex items-center gap-4">
              <ProgressRing
                value={totalScore}
                size={80}
                strokeWidth={6}
                colors={[recommendation.color, recommendation.color]}
                label={`Overall bid score: ${totalScore}%`}
              >
                <span className="text-xl font-bold" style={{ color: recommendation.color }}>
                  {totalScore}
                </span>
              </ProgressRing>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <StatusPulse
                    status={recommendation.status}
                    label={recommendation.verdict}
                    animate={ratedCount > 0}
                  />
                  <span className="text-sm font-semibold" style={{ color: recommendation.color }}>
                    {ratedCount > 0 ? recommendation.verdict : 'Rate criteria to begin'}
                  </span>
                </div>
                <p className="text-tertiary text-xs">
                  Weighted score across {CRITERIA.length} decision factors
                </p>
              </div>
            </div>

            {/* Category Scores */}
            <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 min-w-0">
              {Object.entries(CATEGORY_INFO).map(([cat, info]) => {
                const catScore = categoryScores[cat] ?? 0;
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <ProgressRing
                      value={catScore}
                      size={40}
                      strokeWidth={3}
                      colors={[info.color, info.color]}
                    >
                      <span className="text-[10px] font-bold text-fg-secondary">{catScore}</span>
                    </ProgressRing>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg-primary truncate">{info.label}</p>
                      <p className="text-[10px] text-fg-tertiary">
                        {catScore > 0 ? `${catScore}%` : '—'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </GlassCard>
      </Reveal>

      {/* Criteria Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <AnimatePresence mode="sync">
          {CRITERIA.map((criterion, i) => {
            const currentScore = scores[criterion.id] ?? 0;
            const catInfo = CATEGORY_INFO[criterion.category];
            return (
              <Reveal key={criterion.id} delay={reduced ? 0 : i * 0.03}>
                <GlassCard padding="none" className="depth-card">
                  <div className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div
                        className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{
                          background: `color-mix(in srgb, ${catInfo?.color ?? 'var(--brand-primary)'} 14%, transparent)`,
                        }}
                      >
                        <Icon name={criterion.icon} size={16} style={{ color: catInfo?.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-fg-primary">{criterion.label}</h3>
                        <p className="text-xs text-fg-tertiary mt-0.5 leading-relaxed">
                          {criterion.description}
                        </p>
                      </div>
                      <span className="flex-shrink-0 text-[10px] font-mono text-fg-muted bg-surface-sunken px-1.5 py-0.5 rounded">
                        w:{criterion.weight}
                      </span>
                    </div>

                    {/* Score Selector */}
                    <div className="flex items-center gap-1.5">
                      {([1, 2, 3, 4, 5] as ScoreValue[]).map((val) => (
                        <motion.button
                          key={val}
                          type="button"
                          className="btn-magnetic flex-1 h-8 rounded-md text-xs font-medium border border-border-subtle cursor-pointer"
                          style={{
                            background:
                              currentScore === val ? SCORE_COLORS[val] : 'var(--surface-sunken)',
                            color: currentScore === val ? 'white' : 'var(--fg-secondary)',
                            borderColor:
                              currentScore === val ? SCORE_COLORS[val] : 'var(--border-subtle)',
                          }}
                          whileTap={reduced ? undefined : { scale: 0.93 }}
                          onClick={() => handleScore(criterion.id, currentScore === val ? 0 : val)}
                          aria-label={`${criterion.label}: ${SCORE_LABELS[val]}`}
                          aria-pressed={currentScore === val}
                        >
                          {val}
                        </motion.button>
                      ))}
                    </div>
                    {currentScore > 0 && (
                      <motion.p
                        className="text-[10px] text-fg-tertiary mt-1.5 text-center"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        {SCORE_LABELS[currentScore]}
                      </motion.p>
                    )}
                  </div>
                </GlassCard>
              </Reveal>
            );
          })}
        </AnimatePresence>
      </div>

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
