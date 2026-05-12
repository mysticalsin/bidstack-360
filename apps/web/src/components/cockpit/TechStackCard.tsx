import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';

import { TechLogo } from '@/components/company/TechLogo';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateMessages';
import { springSnap } from '@/lib/motion';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

// Memoized: the cockpit prop is a stable reference per-query, and this card
// pure-renders from it — re-renders only when the snapshot changes, not
// when sibling cards (notes, files) fetch.
export const TechStackCard = memo(function TechStackCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  if (cockpit.technicalStack.length === 0) {
    return (
      <Card role="region" aria-label="Technical Stack Overview">
        <SectionHeader title="Technical Stack Overview" />
        <div style={{ padding: '14px 18px 18px' }}>
          <EmptyState
            title="No stack data yet"
            message="Enrich this account to discover its stack."
          />
        </div>
      </Card>
    );
  }
  return (
    <Card role="region" aria-label="Technical Stack Overview">
      <SectionHeader title="Technical Stack Overview" caption="From discovery & enrichment" />
      <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {cockpit.technicalStack.slice(0, 3).map((cat) => (
          <div key={cat.label}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--fg-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 6,
              }}
            >
              {cat.label}
            </div>
            <div className="tech-pills">
              {cat.items.slice(0, 6).map((item, index) => (
                <motion.span
                  key={item.name}
                  className="tech-pill"
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  whileHover={reducedMotion ? undefined : { y: -2, scale: 1.02 }}
                  whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                  transition={{ ...springSnap, delay: reducedMotion ? 0 : index * 0.025 }}
                >
                  <TechLogo name={item.name} size={14} />
                  {item.name}
                </motion.span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
});
