const fs = require('fs');

const chunks = {
  constants: fs.readFileSync('.tmp/chunk-constants.ts', 'utf8'),
  buildDashboardSnapshot: fs.readFileSync('.tmp/chunk-buildDashboardSnapshot.ts', 'utf8'),
  buildCompanies: fs.readFileSync('.tmp/chunk-buildCompanies.ts', 'utf8'),
  buildCockpit: fs.readFileSync('.tmp/chunk-buildCockpit.ts', 'utf8'),
  serializeDeal: fs.readFileSync('.tmp/chunk-serializeDeal.ts', 'utf8'),
  serializeBidOpportunity: fs.readFileSync('.tmp/chunk-serializeBidOpportunity.ts', 'utf8'),
  defaults: fs.readFileSync('.tmp/chunk-defaults.ts', 'utf8'),
  technicalStack: fs.readFileSync('.tmp/chunk-technicalStack.ts', 'utf8'),
  buildDataQualityReport: fs.readFileSync('.tmp/chunk-buildDataQualityReport.ts', 'utf8'),
  helpers: fs.readFileSync('.tmp/chunk-helpers.ts', 'utf8'),
};

// Update buildDashboardSnapshot signature and use parameter prisma instead of global
let snapshotCode = chunks.buildDashboardSnapshot;
snapshotCode = snapshotCode.replace(
  'async function buildDashboardSnapshot(\n  orgId: string,\n  accountId?: string,\n): Promise<z.infer<typeof CrmDashboardSnapshot>> {',
  'export async function buildDashboardSnapshot(\n  orgId: string,\n  accountId: string | undefined,\n  prisma: PrismaClient,\n  _logger: LoggerLike,\n): Promise<z.infer<typeof CrmDashboardSnapshot>> {'
);
// Note: snapshotCode already uses `prisma.` calls which match the parameter name

// Export buildDataQualityReport
let dqCode = chunks.buildDataQualityReport;
dqCode = dqCode.replace(
  'function buildDataQualityReport(',
  'export function buildDataQualityReport('
);

// Export shared helpers used by crm.ts
const sharedExports = [
  'function normalizeDomain',
  'function normalizeRegistryValue',
  'function normalizeName',
  'function attribution',
  'function domainFor',
  'function websiteFor',
  'function logoUrlFor',
  'function serializeCompany',
  'function serializeWidget',
];

let allCode = [
  chunks.constants,
  snapshotCode,
  chunks.buildCompanies,
  chunks.buildCockpit,
  chunks.serializeDeal,
  chunks.serializeBidOpportunity,
  chunks.defaults,
  chunks.technicalStack,
  dqCode,
  chunks.helpers,
].join('\n');

// Add export to shared helpers
for (const fn of sharedExports) {
  allCode = allCode.replace(fn, 'export ' + fn);
}

const header = `import { z } from 'zod';

import {
  PrismaClient,
  type OpportunityStage as PrismaStage,
  type CompanyEnrichment,
  type RiskRegisterItem as PrismaRiskRegisterItem,
  type ComplianceCheck as PrismaComplianceCheck,
  type ProviderHealth as PrismaProviderHealth,
  type QueueHealth as PrismaQueueHealth,
  type ReleaseScore as PrismaReleaseScore,
} from '@bidstack/db';
import {
  AccountCockpitSnapshot,
  CrmDashboardSnapshot,
  DashboardWidget,
  DataQualityReport,
  ProviderHealth,
  ReleaseScore,
  SourceAttribution,
  type AiInsight,
  type BidOpportunity,
  type CrmActivity,
  type CrmCompany,
  type CrmDeal,
  type CrmLogoSource,
  type QueueHealth,
  type SourceAttribution as SourceAttributionType,
} from '@bidstack/shared';

import { buildConnectorCatalog } from '../providers/open-data-connectors.js';

export type LoggerLike = {
  warn: (obj: unknown, msg?: string) => void;
};

`;

fs.writeFileSync('apps/api/src/services/crm/dashboard.service.ts', header + allCode);
console.log('Wrote dashboard.service.ts');
