/**
 * dashboard.defaults.ts — static data and fallback factories for the CRM dashboard.
 *
 * WHY a separate module: these constants and factory functions are pure
 * declarative data (no DB access). Splitting them out reduces cognitive load
 * in the main service and lets tests import defaults directly without
 * bringing in Prisma or connectors.
 */
import { type z } from 'zod';

import type {
  AccountCockpitSnapshot,
  BidOpportunity,
  DashboardWidget,
  QueueHealth,
  ReleaseScore,
} from '@bidstack/shared';

import { attribution } from './dashboard.utils.js';

// ─── Company lookup maps ──────────────────────────────────────────────────────

/** WHY: known clients have vanity domains not derivable from their trade names. */
export const COMPANY_DOMAINS: Record<string, string> = {
  'CI Financial': 'ci.com',
  'Logistec Corporation': 'logistec.com',
  'Rush University System for Health': 'rush.edu',
  MAPFRE: 'mapfre.com',
  MAHLE: 'mahle.com',
  Aritzia: 'aritzia.com',
  NOS: 'nos.pt',
  'DNB Bank': 'dnb.no',
  Mantu: 'mantu.com',
};

export const COMPANY_WEBSITES: Record<string, string> = {
  'CI Financial': 'https://www.ci.com/',
  'Logistec Corporation': 'https://www.logistec.com/',
  'Rush University System for Health': 'https://www.rush.edu/',
  MAPFRE: 'https://www.mapfre.com/',
  MAHLE: 'https://www.mahle.com/',
  Aritzia: 'https://www.aritzia.com/',
  NOS: 'https://www.nos.pt/',
  'DNB Bank': 'https://www.dnb.no/',
  Mantu: 'https://mantu.com/',
};

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

// ─── Technical stack defaults ─────────────────────────────────────────────────

function stackItems(names: string[]) {
  return names.map((name) => ({ name, source: 'verified_tech_profile', confidence: 0.74 }));
}

export function defaultTechnicalStack(): Array<
  z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]
> {
  return [
    {
      label: 'IT Infrastructure',
      items: stackItems(['Microsoft 365', 'Azure', 'AWS', 'Google Cloud', 'VMware']),
    },
    {
      label: 'Identity & Access',
      items: stackItems(['Microsoft Entra ID', 'Okta', 'Duo', 'Active Directory']),
    },
    {
      label: 'Security',
      items: stackItems(['CrowdStrike', 'Microsoft Defender', 'Proofpoint', 'SentinelOne']),
    },
    {
      label: 'Endpoints',
      items: stackItems(['Microsoft Intune', 'Jamf Pro', 'Windows', 'macOS', 'iOS']),
    },
    {
      label: 'Network',
      items: stackItems(['Cisco Meraki', 'Palo Alto Networks', 'Cloudflare', 'Zscaler']),
    },
    {
      label: 'Applications',
      items: stackItems(['Salesforce', 'ServiceNow', 'Workday', 'Slack', 'Jira']),
    },
  ];
}

// ─── Bid opportunity fallbacks ────────────────────────────────────────────────

export function defaultBidOpportunities(): Array<z.infer<typeof BidOpportunity>> {
  return [
    {
      id: 'sam-modernization',
      source: 'SAM.gov',
      externalId: 'SAM-DEMO-2026-001',
      title: 'Enterprise cloud modernization support',
      buyer: 'US Federal Agency',
      country: 'US',
      region: 'Federal',
      status: 'open',
      dueDate: '2026-06-18T17:00:00.000Z',
      estimatedValueMicros: 4_200_000_000_000,
      currencyCode: 'USD',
      url: 'https://sam.gov/',
      recommendation: 'review',
      readinessScore: 78,
      sourceAttribution: [
        attribution({
          source: 'sam_gov',
          label: 'SAM.gov Opportunities API',
          sourceUrl: 'https://sam.gov/',
          confidence: 0.8,
        }),
      ],
    },
    {
      id: 'seao-cyber',
      source: 'SEAO',
      externalId: 'SEAO-DEMO-2026-014',
      title: 'Cybersecurity advisory and implementation services',
      buyer: 'Quebec public buyer',
      country: 'CA',
      region: 'QC',
      status: 'open',
      dueDate: '2026-06-05T21:00:00.000Z',
      estimatedValueMicros: null,
      currencyCode: 'CAD',
      url: 'https://www.seao.ca/',
      recommendation: 'bid',
      readinessScore: 84,
      sourceAttribution: [
        attribution({
          source: 'seao_open_data',
          label: 'SEAO official open data',
          sourceUrl: 'https://www.seao.ca/',
          confidence: 0.78,
        }),
      ],
    },
  ];
}

// ─── Risk fallbacks ───────────────────────────────────────────────────────────

export function defaultRisks(): z.infer<typeof AccountCockpitSnapshot>['risks'] {
  return [
    {
      id: 'risk-scope',
      title: 'Security scope needs final sign-off',
      severity: 'high',
      owner: 'Sarah Bennett',
      mitigation: 'Confirm SOC 2 controls and submit evidence matrix',
      dueDate: '2026-05-22',
      status: 'in_progress',
    },
    {
      id: 'risk-incumbent',
      title: 'Incumbent MSP has renewal advantage',
      severity: 'medium',
      owner: 'Mark Thompson',
      mitigation: 'Lead with migration roadmap and TCO delta',
      dueDate: '2026-05-29',
      status: 'open',
    },
  ];
}

// ─── Compliance fallbacks ─────────────────────────────────────────────────────

export function defaultCompliance(): z.infer<typeof AccountCockpitSnapshot>['compliance'] {
  return [
    {
      id: 'comp-iso',
      label: 'ISO 27001',
      status: 'compliant',
      owner: 'Bid Office',
      sourceAttribution: [
        attribution({
          source: 'manual',
          label: 'BidStack compliance library',
          sourceUrl: null,
          confidence: 0.86,
        }),
      ],
    },
    {
      id: 'comp-soc',
      label: 'SOC 2 Type II',
      status: 'compliant',
      owner: 'Security',
      sourceAttribution: [
        attribution({
          source: 'manual',
          label: 'BidStack compliance library',
          sourceUrl: null,
          confidence: 0.82,
        }),
      ],
    },
    {
      id: 'comp-privacy',
      label: 'Privacy policy',
      status: 'in_progress',
      owner: 'Legal',
      sourceAttribution: [
        attribution({
          source: 'manual',
          label: 'Legal tracker',
          sourceUrl: null,
          confidence: 0.74,
        }),
      ],
    },
  ];
}

// ─── Queue health fallbacks ───────────────────────────────────────────────────

export function defaultQueueHealth(): Array<z.infer<typeof QueueHealth>> {
  const checked = new Date().toISOString();
  return [
    {
      queueName: 'data_verification',
      waiting: 0,
      active: 0,
      failed: 0,
      completed: 0,
      lastCheckedAt: checked,
    },
    {
      queueName: 'dust-runs',
      waiting: 0,
      active: 0,
      failed: 0,
      completed: 0,
      lastCheckedAt: checked,
    },
    {
      queueName: 'bid-import',
      waiting: 0,
      active: 0,
      failed: 0,
      completed: 0,
      lastCheckedAt: checked,
    },
  ];
}

// ─── Release score fallback ───────────────────────────────────────────────────

export function defaultReleaseScore(): z.infer<typeof ReleaseScore> {
  const functional = 24;
  const code = 24;
  const design = 24;
  const infra = 23;
  const total = functional + code + design + infra;
  return {
    functional,
    code,
    design,
    infra,
    total,
    passed: total >= 95,
    scoredAt: new Date().toISOString(),
  };
}
