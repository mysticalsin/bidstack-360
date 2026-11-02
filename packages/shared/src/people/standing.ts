// How a person stands on an account. A job title is not an input: callers
// pass facts only. The accept/dismiss idea follows Comp AI CRM (MIT); the
// rules below are Polo's.

export const CONNECTION_STANDINGS = [
  'unknown',
  'evidenced',
  'stale',
  'conflicted',
  'needs_review',
] as const;
export type ConnectionStanding = (typeof CONNECTION_STANDINGS)[number];

export const FACT_KINDS = ['reports_to', 'buying_role', 'company_link'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_STATUSES = ['proposed', 'accepted', 'dismissed', 'needs_review'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const DEAL_EVIDENCE = ['label_on_file', 'accepted', 'needs_review'] as const;
export type DealEvidence = (typeof DEAL_EVIDENCE)[number];

/** Half a year. Older accepted facts stay on the record but read as stale. */
export const EVIDENCE_FRESH_MS = 180 * 24 * 60 * 60 * 1000;

export interface PersonFactView {
  id: string;
  kind: FactKind;
  status: FactStatus;
  reportsToContactId: string | null;
  opportunityId: string | null;
  companyId: string | null;
  linkLabel: string | null;
  observedAt: string | null;
}

export interface FactIntake {
  kind: FactKind;
  reportsToContactId: string | null;
  opportunityId: string | null;
  companyId: string | null;
  linkLabel: string | null;
  /** The source text did not name a person or a deal. Do not guess a link. */
  ambiguous: boolean;
}

export interface FactLink {
  status: 'proposed' | 'needs_review' | 'accepted' | 'dismissed';
  reportsToContactId: string | null;
  opportunityId: string | null;
  companyId: string | null;
  linkLabel: string | null;
}

const UNLINKED: Omit<FactLink, 'status'> = {
  reportsToContactId: null,
  opportunityId: null,
  companyId: null,
  linkLabel: null,
};

/**
 * A person with no accepted fact is unknown. A suggestion (proposed) is not
 * evidence. needs_review is only for text we refused to link.
 */
export function connectionStanding(facts: PersonFactView[], now: Date): ConnectionStanding {
  const accepted = facts.filter((fact) => fact.status === 'accepted');
  if (accepted.length === 0) {
    if (facts.some((fact) => fact.status === 'needs_review')) return 'needs_review';
    return 'unknown';
  }
  if (acceptedFactsConflict(accepted)) return 'conflicted';
  if (accepted.every((fact) => factIsStale(fact, now))) return 'stale';
  return 'evidenced';
}

export function factIsStale(fact: PersonFactView, now: Date): boolean {
  if (fact.status !== 'accepted' || !fact.observedAt) return false;
  const observed = Date.parse(fact.observedAt);
  if (Number.isNaN(observed)) return false;
  return now.getTime() - observed > EVIDENCE_FRESH_MS;
}

export function acceptedFactsConflict(facts: PersonFactView[]): boolean {
  const groups = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (fact.status !== 'accepted') continue;
    const key = conflictKey(fact);
    const set = groups.get(key) ?? new Set<string>();
    set.add(conflictValue(fact));
    groups.set(key, set);
  }
  for (const values of groups.values()) {
    if (values.size > 1) return true;
  }
  return false;
}

/**
 * Draw a reporting line only from one fresh accepted target. Two targets,
 * a suggestion, or a stale claim draw nothing — the line stays unknown.
 */
export function resolvedReportsToId(facts: PersonFactView[], now: Date): string | null {
  const accepted = facts.filter(
    (fact) =>
      fact.status === 'accepted' &&
      fact.kind === 'reports_to' &&
      fact.reportsToContactId !== null &&
      !factIsStale(fact, now),
  );
  const ids = new Set(accepted.map((fact) => fact.reportsToContactId));
  if (ids.size !== 1) return null;
  return accepted[0]?.reportsToContactId ?? null;
}

/**
 * Ambiguous historical text is stored as needs_review with every link
 * cleared, even if a caller passed an id. Named targets become a suggestion,
 * not an accepted fact.
 */
export function intakePersonFact(input: FactIntake): FactLink {
  if (input.ambiguous) return { status: 'needs_review', ...UNLINKED };
  if (input.kind === 'reports_to') {
    if (!input.reportsToContactId) return { status: 'needs_review', ...UNLINKED };
    return { status: 'proposed', ...UNLINKED, reportsToContactId: input.reportsToContactId };
  }
  if (input.kind === 'buying_role') {
    if (!input.opportunityId || !input.linkLabel) return { status: 'needs_review', ...UNLINKED };
    return {
      status: 'proposed',
      ...UNLINKED,
      opportunityId: input.opportunityId,
      linkLabel: input.linkLabel,
    };
  }
  if (!input.companyId) return { status: 'needs_review', ...UNLINKED };
  return { status: 'proposed', ...UNLINKED, companyId: input.companyId };
}

export function applyFactDecision(
  fact: FactLink & { kind: FactKind },
  decision: 'accept' | 'dismiss',
  supplied?: Partial<Omit<FactLink, 'status'>>,
): FactLink {
  if (decision === 'dismiss') return { status: 'dismissed', ...UNLINKED };
  const intake = intakePersonFact({
    kind: fact.kind,
    ambiguous: false,
    reportsToContactId: supplied?.reportsToContactId ?? fact.reportsToContactId,
    opportunityId: supplied?.opportunityId ?? fact.opportunityId,
    companyId: supplied?.companyId ?? fact.companyId,
    linkLabel: supplied?.linkLabel ?? fact.linkLabel,
  });
  if (intake.status === 'needs_review') return intake;
  return { ...intake, status: 'accepted' };
}

function conflictKey(fact: PersonFactView): string {
  if (fact.kind === 'buying_role') return `buying_role:${fact.opportunityId ?? 'none'}`;
  return fact.kind;
}

function conflictValue(fact: PersonFactView): string {
  if (fact.kind === 'reports_to') return fact.reportsToContactId ?? '';
  if (fact.kind === 'company_link') return fact.companyId ?? '';
  return fact.linkLabel ?? '';
}
