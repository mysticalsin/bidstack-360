import { Bell, BellOff, BellRing } from 'lucide-react';
import type {
  AccountFollowAction,
  AccountFollowReason,
  AccountFollowState,
} from '@bidstack/shared';

import { useAccountFollow, useSetAccountFollow } from '@/hooks/useAccountTeam';

const REASON_TEXT: Record<AccountFollowReason, string> = {
  team: 'You are on the account team',
  key_account_owner: 'You own this account',
  opportunity_owner: 'You own a deal on this account',
  explicit: 'You follow this account',
};

interface View {
  label: string;
  next: AccountFollowAction['action'];
  hint: string;
  icon: typeof Bell;
  pressed: boolean;
}

export function followView(state: AccountFollowState): View {
  const why = state.reasons.map((r) => REASON_TEXT[r]).join('. ');
  if (state.muted) {
    return {
      label: 'Muted',
      next: 'unmute',
      hint: `${why}. Alerts are muted; click to unmute.`,
      icon: BellOff,
      pressed: false,
    };
  }
  if (!state.following) {
    return {
      label: 'Follow',
      next: 'follow',
      hint: 'Get alerts when someone else acts on this account',
      icon: Bell,
      pressed: false,
    };
  }
  const automatic = state.reasons.some((r) => r !== 'explicit');
  return automatic
    ? {
        label: 'Following',
        next: 'mute',
        hint: `${why}. Click to mute alerts.`,
        icon: BellRing,
        pressed: true,
      }
    : {
        label: 'Following',
        next: 'unfollow',
        hint: `${why}. Click to unfollow.`,
        icon: BellRing,
        pressed: true,
      };
}

export function FollowAccountButton({ companyId }: { companyId: string }) {
  const follow = useAccountFollow(companyId);
  const set = useSetAccountFollow(companyId);
  if (!follow.data) return null;
  const view = followView(follow.data);
  const Icon = view.icon;
  return (
    <button
      type="button"
      aria-pressed={view.pressed}
      title={view.hint}
      disabled={set.isPending}
      onClick={() => set.mutate(view.next)}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] disabled:opacity-60 ${
        view.pressed
          ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]'
          : 'border-[var(--border-subtle)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]'
      }`}
    >
      <Icon aria-hidden="true" size={14} /> {view.label}
      <span className="sr-only">. {view.hint}</span>
    </button>
  );
}
