// Individual criterion scoring card for the Bid/No-Bid decision matrix.
import { motion } from 'framer-motion';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { Reveal } from '@/components/motion/Reveal';

import type { Criterion, ScoreValue } from './bidNoBidTypes';
import { CATEGORY_INFO, SCORE_COLORS, SCORE_LABELS } from './bidNoBidTypes';

export function CriterionCard({
  criterion,
  currentScore,
  onScore,
  reduced,
  delay,
}: {
  criterion: Criterion;
  currentScore: ScoreValue;
  onScore: (id: string, val: ScoreValue) => void;
  reduced: boolean;
  delay: number;
}) {
  const catInfo = CATEGORY_INFO[criterion.category];

  return (
    <Reveal delay={delay}>
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
              <h2 className="text-sm font-semibold text-fg-primary">{criterion.label}</h2>
              <p className="text-xs text-fg-tertiary mt-0.5 leading-relaxed">
                {criterion.description}
              </p>
            </div>
            <span className="flex-shrink-0 text-[10px] font-mono text-fg-secondary bg-surface-sunken px-1.5 py-0.5 rounded">
              w:{criterion.weight}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {([1, 2, 3, 4, 5] as ScoreValue[]).map((val) => (
              <motion.button
                key={val}
                type="button"
                className="btn-magnetic flex-1 h-8 rounded-md text-xs font-medium border border-border-subtle cursor-pointer"
                style={{
                  background: currentScore === val ? SCORE_COLORS[val] : 'var(--surface-sunken)',
                  color: currentScore === val ? 'white' : 'var(--fg-secondary)',
                  borderColor: currentScore === val ? SCORE_COLORS[val] : 'var(--border-subtle)',
                }}
                whileTap={reduced ? undefined : { scale: 0.93 }}
                onClick={() => onScore(criterion.id, currentScore === val ? 0 : val)}
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
}
