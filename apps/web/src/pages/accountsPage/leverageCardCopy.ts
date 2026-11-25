// The accounts list already loads MSA leverage flags. The card only showed
// pipeline health, so a HEMA account with no IT business looked like any other
// empty book. This picks the one sentence the card can say without a second click.

export type LeverageScopeKind = 'amendment' | 'allowed' | 'unstated';

export interface LeverageCardFlag {
  headline: string;
  scopeNeedsAmendment: boolean;
  scopeAllowsOtherServices: boolean | null;
}

export interface LeverageCardModel {
  headline: string;
  scope: LeverageScopeKind;
  extraCount: number;
}

// Same three facts as the agreement leverage flag. Amendment wins, because a
// scope that blocks other lines is the fact a seller has to act on.
export const LEVERAGE_SCOPE_COPY: Record<LeverageScopeKind, string> = {
  amendment: 'Scope may need amendment before other lines can use this MSA.',
  allowed: 'The scope or affiliates clause already allows other services.',
  unstated: 'Scope coverage for other lines is not stated.',
};

export function leverageScopeKind(flag: LeverageCardFlag): LeverageScopeKind {
  if (flag.scopeNeedsAmendment) return 'amendment';
  if (flag.scopeAllowsOtherServices) return 'allowed';
  return 'unstated';
}

export function leverageCardModel(flags: LeverageCardFlag[]): LeverageCardModel | null {
  const firstIndex = flags.findIndex((flag) => flag.headline.trim().length > 0);
  if (firstIndex < 0) return null;
  const first = flags[firstIndex]!;
  return {
    headline: first.headline.trim(),
    scope: leverageScopeKind(first),
    extraCount: flags.length - firstIndex - 1,
  };
}
