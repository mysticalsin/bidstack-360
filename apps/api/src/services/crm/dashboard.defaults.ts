/**
 * dashboard.defaults.ts — static data and fallback factories for the CRM dashboard.
 *
 * WHY a separate module: these constants and factory functions are pure
 * declarative data (no DB access). Splitting them out reduces cognitive load
 * in the main service and lets tests import defaults directly without
 * bringing in Prisma or connectors.
 */
import { type z } from 'zod';

import type { DashboardWidget, QueueHealth, ReleaseScore } from '@bidstack/shared';

// ─── Dashboard widget layout ──────────────────────────────────────────────────

export const DEFAULT_WIDGETS: Array<z.infer<typeof DashboardWidget>> = [
  {
    id: 'widget-pipeline',
    kind: 'pipeline_funnel',
    title: 'Pipeline Funnel',
    x: 0,
    y: 0,
    w: 4,
    h: 3,
    config: {},
  },
  {
    id: 'widget-forecast',
    kind: 'revenue_forecast',
    title: 'Revenue Forecast',
    x: 4,
    y: 0,
    w: 4,
    h: 3,
    config: {},
  },
  {
    id: 'widget-companies',
    kind: 'company_grid',
    title: 'Company Grid',
    x: 8,
    y: 0,
    w: 4,
    h: 3,
    config: {},
  },
  {
    id: 'widget-insights',
    kind: 'ai_insights_feed',
    title: 'AI Insights Feed',
    x: 0,
    y: 3,
    w: 6,
    h: 3,
    config: {},
  },
  {
    id: 'widget-activity',
    kind: 'activity_timeline',
    title: 'Activity Timeline',
    x: 6,
    y: 3,
    w: 6,
    h: 3,
    config: {},
  },
];

// Account catalogs (a sample tech stack, demo SAM bids, invented risks, and
// a SOC 2 "compliant" row) used to be merged into every cockpit. They are
// gone. An account shows only what was stored.

// ─── Queue health fallbacks ───────────────────────────────────────────────────

/** No stored queue check is not an idle queue. Callers should return []. */
export function defaultQueueHealth(): Array<z.infer<typeof QueueHealth>> {
  return [];
}

// ─── Release score fallback ───────────────────────────────────────────────────

export function defaultReleaseScore(): z.infer<typeof ReleaseScore> {
  // No stored rubric. A fabricated 95 used to read as a measured pass.
  return {
    functional: 0,
    code: 0,
    design: 0,
    infra: 0,
    total: 0,
    passed: false,
    scoredAt: new Date(0).toISOString(),
  };
}
