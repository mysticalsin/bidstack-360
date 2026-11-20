/**
 * dashboard/widgets/dashboard-types.ts — shared types, constants, and pure
 * helpers for the OrgDashboard widget family.
 *
 * WHY a separate module: KpiTone, TONE_*, STAGE_COLORS, stageColor, and
 * stageLabel are referenced in six different widget files. Centralising them
 * here avoids circular deps and keeps every widget import-light.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OrgKpi {
  label: string;
  value: number;
  detail: string;
  tone: KpiTone;
  icon: string;
  href: string;
  trend?: number; // percent change
  signal: SignalPoint[];
  /** The one metric the strip is allowed to accent (see KpiRow) — at most one. */
  emphasis?: boolean;
}

export type KpiTone = 'blue' | 'jade' | 'purple' | 'amber' | 'teal' | 'rose';

export type PipelineStagePoint = { stage: string; count: number; valueSum: number };

export type SignalPoint = {
  label: string;
  value: number;
  color?: string;
};

// ─── Tone token maps ─────────────────────────────────────────────────────────

export const TONE_BG: Record<KpiTone, string> = {
  blue: 'var(--tag-blue-bg)',
  jade: 'var(--tag-jade-bg)',
  purple: 'var(--tag-purple-bg)',
  amber: 'var(--tag-amber-bg)',
  teal: 'var(--tag-teal-bg)',
  rose: 'var(--tag-rose-bg)',
};

export const TONE_FG: Record<KpiTone, string> = {
  blue: 'var(--tag-blue-fg)',
  jade: 'var(--tag-jade-fg)',
  purple: 'var(--tag-purple-fg)',
  amber: 'var(--tag-amber-fg)',
  teal: 'var(--tag-teal-fg)',
  rose: 'var(--tag-rose-fg)',
};

export const TONE_GLOW: Record<KpiTone, string> = {
  blue: 'color-mix(in srgb, var(--tag-blue-fg) 18%, transparent)',
  jade: 'color-mix(in srgb, var(--tag-jade-fg) 18%, transparent)',
  purple: 'color-mix(in srgb, var(--tag-purple-fg) 18%, transparent)',
  amber: 'color-mix(in srgb, var(--tag-amber-fg) 18%, transparent)',
  teal: 'color-mix(in srgb, var(--tag-teal-fg) 18%, transparent)',
  rose: 'color-mix(in srgb, var(--tag-rose-fg) 18%, transparent)',
};

// ─── Stage helpers ───────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  prospecting: 'var(--tag-blue-fg)',
  discovery: 'var(--tag-purple-fg)',
  proposal: 'var(--tag-amber-fg)',
  negotiation: 'var(--tag-teal-fg)',
  closed_won: 'var(--tag-jade-fg)',
  closed_lost: 'var(--tag-rose-fg)',
};

export function stageColor(stage: string): string {
  return STAGE_COLORS[stage] ?? 'var(--brand-primary)';
}

export function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ');
}
