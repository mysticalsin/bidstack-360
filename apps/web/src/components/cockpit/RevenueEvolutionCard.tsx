import { memo } from 'react';

import { Card, SectionHeader } from '@/components/ui/Card';
import { useDisplayMoneyMicros } from '@/hooks/useDisplayMoney';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

/**
 * Revenue evolution with this client (M3). Data source: ABC via API.
 * Renders ONLY when SHOW_REVENUE_BLOCK is on AND the API delivered points —
 * the brief forbids empty/null placeholder states for unavailable sources.
 */
export const RevenueEvolutionCard = memo(function RevenueEvolutionCard({ cockpit }: Props) {
  const flags = useFeatureFlags();
  const points = cockpit.revenueEvolution ?? [];
  if (!flags.showRevenueBlock || points.length === 0) return null;

  const max = Math.max(...points.map((p) => p.revenueMicros), 1);
  return (
    <Card role="region" aria-label="Revenue evolution">
      <SectionHeader title="Revenue evolution" caption="ABC revenue with this client over time" />
      <div className="flex items-end gap-2 px-5 pb-5" style={{ minHeight: 120 }}>
        {points.map((p) => (
          <RevenueBar key={p.period} period={p.period} micros={p.revenueMicros} max={max} />
        ))}
      </div>
    </Card>
  );
});

function RevenueBar({ period, micros, max }: { period: string; micros: number; max: number }) {
  const formatted = useDisplayMoneyMicros(micros, 'EUR', { compact: true });
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <div
        className="w-full rounded-t bg-[var(--brand-primary)]"
        style={{ height: `${Math.max(6, (micros / max) * 96)}px` }}
        role="img"
        aria-label={`${period}: ${formatted}`}
      />
      <span className="text-[10px] text-[var(--fg-tertiary)]">{period}</span>
    </div>
  );
}
