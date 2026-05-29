/**
 * agentsConfig — constants and pure utilities shared across the Agents page
 * and its sub-components. No React imports — safe to import from any layer.
 */
import type { IconName } from '@/components/ui/Icon';
import type { Agent } from '@/hooks/useAgents';

export const ALL_PHASES = 'all';

export const STATUS_MAP: Record<
  Agent['status'],
  { label: string; tone: 'jade' | 'amber' | 'tomato' | 'gray' }
> = {
  idle: { label: 'Idle', tone: 'jade' },
  running: { label: 'Running', tone: 'amber' },
  error: { label: 'Error', tone: 'tomato' },
  disabled: { label: 'Disabled', tone: 'gray' },
};

export const RUN_STATUS_MAP: Record<string, 'jade' | 'tomato' | 'amber' | 'gray'> = {
  completed: 'jade',
  failed: 'tomato',
  running: 'amber',
  queued: 'gray',
  cancelled: 'gray',
};

export const PHASE_TONE: Record<
  string,
  'blue' | 'jade' | 'amber' | 'tomato' | 'purple' | 'teal' | 'rose' | 'gray'
> = {
  opportunity_qualification: 'gray',
  document_intake: 'blue',
  solicitation_deep_read: 'purple',
  compliance_matrix: 'teal',
  red_flags: 'tomato',
  solution_strategy: 'jade',
  pricing_commercial: 'amber',
  legal_review: 'rose',
  security_privacy: 'blue',
  draft_response: 'purple',
  color_team_review: 'teal',
  submission_readiness: 'amber',
  post_submission: 'gray',
};

/** Metric card definition passed to AgentsCommandCenter. */
export interface CommandMetric {
  label: string;
  value: string;
  detail: string;
  icon: IconName;
  tone: 'blue' | 'purple' | 'amber' | 'jade' | 'teal';
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatPhase(value: string | undefined): string {
  if (!value) return 'General';
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function lastRunLabel(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function countByPhase(items: Array<{ phase?: string }>): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    if (!item.phase) return acc;
    acc[item.phase] = (acc[item.phase] ?? 0) + 1;
    return acc;
  }, {});
}
