/* eslint-disable react-refresh/only-export-components --
 * This is the proposal-status "kit": the chip component lives next to its tone +
 * label maps and the string-safe helpers on purpose, so callers have one import
 * site and the palette can never drift from the chip. The only cost is Fast
 * Refresh treating this as a non-pure-component module — acceptable for a tiny
 * constants+component module that rarely changes. */
// Single source of truth for proposal-status tone + label across the RFP
// surfaces (Hub, Proposals, Proposal detail, Admin analytics).
//
// WHY this exists: the six ProposalStatus values had THREE divergent color
// systems — the Hub's dark-mode-safe token map, AdminRfp's copy of it, and
// ProposalsPage's raw Tailwind palette (bg-emerald-100 …, which breaks dark
// mode) — and statuses rendered as raw enums (REVIEW / draft) instead of human
// labels. This module is the one place that maps a status to its tone + label,
// so it reads identically everywhere. (RfpStatusChip remains the source of
// truth for the PipelineStage enum — do not duplicate that here.)

export type ProposalStatus = 'draft' | 'review' | 'approved' | 'submitted' | 'won' | 'lost';

// Token tag palette only (light + dark safe) — mirrors the Hub's deliberate
// choice. Never raw Tailwind palette classes here.
export const PROPOSAL_STATUS_TONE: Record<ProposalStatus, string> = {
  draft: 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)]',
  review: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
  approved: 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]',
  submitted: 'bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]',
  won: 'bg-[var(--success)] text-[var(--fg-on-brand)]',
  lost: 'bg-[var(--danger)] text-[var(--fg-on-brand)]',
};

// Human labels — never show the raw enum to a user.
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
  submitted: 'Submitted',
  won: 'Won',
  lost: 'Lost',
};

const FALLBACK_TONE = 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)]';

/** Tone classes for a status that may arrive as a plain string (e.g. an API
 *  aggregate). Falls back to the neutral draft tone for unknown values. */
export function proposalStatusTone(status: string): string {
  return PROPOSAL_STATUS_TONE[status as ProposalStatus] ?? FALLBACK_TONE;
}

/** Human label for a status that may arrive as a plain string. Falls back to a
 *  capitalised form so an unexpected value is still readable, never raw. */
export function proposalStatusLabel(status: string): string {
  return (
    PROPOSAL_STATUS_LABELS[status as ProposalStatus] ??
    status.charAt(0).toUpperCase() + status.slice(1)
  );
}

/** Standard per-proposal status chip. Use everywhere a single proposal's status
 *  is shown so the color + label are identical across surfaces. */
export function ProposalStatusChip({
  status,
  className = '',
}: {
  status: ProposalStatus;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${PROPOSAL_STATUS_TONE[status]} ${className}`}
    >
      {PROPOSAL_STATUS_LABELS[status]}
    </span>
  );
}
