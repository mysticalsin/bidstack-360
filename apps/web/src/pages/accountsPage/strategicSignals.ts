import type { TopAccountsSource } from '@/hooks/useTopAccounts';

export interface StrategicSignal {
  status: 'complete' | 'needs_action';
  missing: string[];
  reason: string;
  nextAction: string;
}

interface MissingSignal {
  label: string;
  nextAction: string;
}

interface StrategicAccountInput {
  industry: string | null;
  domain: string | null;
  totalValue: number;
  openDeals: number;
  contactCount: number;
  opportunityCount: number;
}

interface KeyAccountSignalInput extends StrategicAccountInput {
  keyAccountNotes: string | null;
}

interface TopAccountSignalInput extends StrategicAccountInput {
  topAccountRank: number | null;
  wonValue: number;
}

interface SectorCoverageSignalInput {
  accountCount: number;
  coverage: {
    knownFteAccounts: number;
    verifiedAccounts: number;
    logoAccounts: number;
  };
}

interface SectorAccountSignalInput {
  domain: string | null;
  employeeCount: number | null;
  source: string;
  confidence: number;
}

export function keyAccountSignal(account: KeyAccountSignalInput): StrategicSignal {
  const missing = missingSignals([
    {
      ok: Boolean(account.industry),
      label: 'industry',
      nextAction: 'Assign an industry to unlock sector routing.',
    },
    {
      ok: Boolean(account.domain),
      label: 'official domain',
      nextAction: 'Add the official domain for enrichment and logo matching.',
    },
    {
      ok: Boolean(account.keyAccountNotes?.trim()),
      label: 'strategy note',
      nextAction: 'Add an executive strategy note with the account owner.',
    },
    {
      ok: account.contactCount > 0,
      label: 'buyer contacts',
      nextAction: 'Map the buyer, sponsor, and delivery owner contacts.',
    },
    {
      ok: account.openDeals > 0 || account.opportunityCount > 0 || account.totalValue > 0,
      label: 'open opportunity',
      nextAction: 'Link an open opportunity or mark this account as watch-only.',
    },
  ]);

  if (missing.length === 0) {
    return {
      status: 'complete',
      missing: [],
      reason: 'Strategic coverage is complete for this account.',
      nextAction: 'Use the cockpit for executive follow-through.',
    };
  }

  return actionSignal(missing);
}

export function topAccountSignal(
  account: TopAccountSignalInput,
  source: TopAccountsSource,
): StrategicSignal {
  const hasRevenueOrOpportunity =
    account.totalValue > 0 ||
    account.wonValue > 0 ||
    account.openDeals > 0 ||
    account.opportunityCount > 0;
  const missing = missingSignals([
    {
      ok: source !== 'curated' || account.topAccountRank != null,
      label: 'curated rank',
      nextAction: 'Confirm this account rank in Settings.',
    },
    {
      ok: Boolean(account.industry),
      label: 'industry',
      nextAction: 'Assign an industry so the top list can roll up by sector.',
    },
    {
      ok: Boolean(account.domain),
      label: 'official domain',
      nextAction: 'Add the official domain for enrichment and visual confidence.',
    },
    {
      ok: account.contactCount > 0,
      label: 'buyer contacts',
      nextAction: 'Map buyer coverage before leadership review.',
    },
    {
      ok: hasRevenueOrOpportunity,
      label: 'revenue signal',
      nextAction: 'Link revenue or opportunity history before ranking this account.',
    },
  ]);

  if (missing.length === 0) {
    return {
      status: 'complete',
      missing: [],
      reason:
        source === 'curated' && account.topAccountRank
          ? `Curated global rank #${account.topAccountRank} with buyer and revenue signals.`
          : 'Auto-ranked from pipeline, revenue, and buyer coverage.',
      nextAction:
        source === 'curated'
          ? 'Reconfirm the rank when pipeline or sponsorship changes.'
          : 'Curate this account if it belongs in the global top 10.',
    };
  }

  return actionSignal(missing);
}

export function sectorCoverageSignal(sector: SectorCoverageSignalInput): StrategicSignal {
  const total = Math.max(0, sector.accountCount);
  const missing = missingSignals([
    {
      ok: total === 0 || sector.coverage.knownFteAccounts >= total,
      label: 'FTE coverage',
      nextAction: 'Add FTE values to size this sector accurately.',
    },
    {
      ok: total === 0 || sector.coverage.verifiedAccounts >= total,
      label: 'verified source coverage',
      nextAction: 'Verify account sources before using this split for planning.',
    },
    {
      ok: total === 0 || sector.coverage.logoAccounts >= total,
      label: 'logo coverage',
      nextAction: 'Attach official domains or logo sources for visual confidence.',
    },
  ]);

  if (missing.length === 0) {
    return {
      status: 'complete',
      missing: [],
      reason: 'Sector coverage is complete across FTE, source, and logo signals.',
      nextAction: 'Use this sector for account planning and territory review.',
    };
  }

  return {
    status: 'needs_action',
    missing: missing.map((signal) => signal.label),
    reason: `Gaps in ${compactList(missing.map((signal) => signal.label).slice(0, 3))}.`,
    nextAction: missing[0]!.nextAction,
  };
}

export function sectorAccountSignal(account: SectorAccountSignalInput): StrategicSignal {
  const missing = missingSignals([
    {
      ok: Boolean(account.domain),
      label: 'official domain',
      nextAction: 'Add the official domain for source verification.',
    },
    {
      ok: account.employeeCount != null,
      label: 'FTE',
      nextAction: 'Add FTE so sector size and account weight are reliable.',
    },
    {
      ok: account.source === 'verified_data',
      label: 'verified source',
      nextAction: 'Confirm this account against a verified source.',
    },
    {
      ok: account.confidence >= 0.7,
      label: 'confidence',
      nextAction: 'Review low-confidence enrichment before using this account.',
    },
  ]);

  if (missing.length === 0) {
    return {
      status: 'complete',
      missing: [],
      reason: 'Verified account signal is strong.',
      nextAction: 'Open the account to review local coverage.',
    };
  }

  return actionSignal(missing);
}

function missingSignals(
  fields: Array<{ ok: boolean; label: string; nextAction: string }>,
): MissingSignal[] {
  return fields
    .filter((field) => !field.ok)
    .map(({ label, nextAction }) => ({ label, nextAction }));
}

function actionSignal(missing: MissingSignal[]): StrategicSignal {
  return {
    status: 'needs_action',
    missing: missing.map((signal) => signal.label),
    reason: `Missing ${compactList(missing.map((signal) => signal.label).slice(0, 3))}.`,
    nextAction: missing[0]!.nextAction,
  };
}

function compactList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
