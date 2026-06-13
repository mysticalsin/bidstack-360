import { memo } from 'react';

import { Card, SectionHeader } from '@/components/ui/Card';
import { useDisplayMoneyMicros } from '@/hooks/useDisplayMoney';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

/**
 * Won/Lost summary for the account (M4). Derived from the account's own
 * opportunity pipeline. Behind WIN_LOSS_DATA_AVAILABLE; rendered only when
 * there are decided deals so a brand-new account shows nothing, not zeros.
 */
export const WinLossCard = memo(function WinLossCard({ cockpit }: Props) {
  const flags = useFeatureFlags();
  const wl = cockpit.winLoss;
  const wonValue = useDisplayMoneyMicros(wl?.wonValueMicros ?? 0, 'EUR', { compact: true });
  if (!flags.winLossDataAvailable || !wl || wl.wonCount + wl.lostCount === 0) return null;

  return (
    <Card role="region" aria-label="Win / loss">
      <SectionHeader title="Win / loss" caption="Decided deals on this account" />
      <div className="px-5 pb-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-3xl font-semibold tabular-nums text-[var(--fg-primary)]">
              {wl.winRate}%
            </div>
            <div className="text-xs text-[var(--fg-tertiary)]">win rate</div>
          </div>
          <div className="text-right text-sm">
            <div className="text-[var(--success)]">{wl.wonCount} won</div>
            <div className="text-[var(--danger)]">{wl.lostCount} lost</div>
          </div>
        </div>
        <div
          className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
          role="img"
          aria-label={`${wl.wonCount} won, ${wl.lostCount} lost`}
        >
          <div
            className="bg-[var(--success)]"
            style={{ width: `${wl.winRate}%` }}
          />
          <div className="flex-1 bg-[var(--danger)]" />
        </div>
        <p className="mt-3 text-xs text-[var(--fg-tertiary)]">
          {wonValue} in won deals
        </p>
      </div>
    </Card>
  );
});
