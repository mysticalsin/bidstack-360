const fs = require('fs');

const CRM_PATH = 'apps/api/src/routes/crm.ts';
const lines = fs.readFileSync(CRM_PATH, 'utf8').split('\n');

// Ranges to REMOVE, in descending order so line numbers stay valid
const removeRanges = [
  [762, 1967],   // all dashboard functions
  [458, 461],    // release-score route
  [420, 427],    // provider-health route
  [414, 418],    // data-quality route
  [273, 289],    // companies/:id route
  [169, 178],    // dashboard route
  [91, 166],     // constants
];

for (const [s, e] of removeRanges) {
  for (let i = s - 1; i < e; i++) {
    lines[i] = null;
  }
}

let output = lines.filter((l) => l !== null);

// Now update the file content via string replacements on the joined output
let content = output.join('\n');

// 1. Update @bidstack/db imports
content = content.replace(
  `import {
  prisma,
  type OpportunityStage as PrismaStage,
  type Prisma,
  type CompanyEnrichment,
  type RiskRegisterItem as PrismaRiskRegisterItem,
  type ComplianceCheck as PrismaComplianceCheck,
  type ProviderHealth as PrismaProviderHealth,
  type QueueHealth as PrismaQueueHealth,
  type ReleaseScore as PrismaReleaseScore,
} from '@bidstack/db';`,
  `import {
  prisma,
  type Prisma,
  type CompanyEnrichment,
} from '@bidstack/db';`
);

// 2. Update @bidstack/shared imports
content = content.replace(
  `import {
  AccountCockpitSnapshot,
  CompanyAutopopulateResponse,
  CompanyLookupResponse,
  CrmCompany,
  CrmDashboardSnapshot,
  DashboardWidget,
  DataQualityReport,
  CrmConnector,
  OpenDataSignalsResponse,
  ProviderHealth,
  ReleaseScore,
  SourceAttribution,
  type AiInsight,
  type BidOpportunity,
  type CrmActivity,
  type CrmDeal,
  type CrmLogoSource,
  type QueueHealth,
  type SourceAttribution as SourceAttributionType,
} from '@bidstack/shared';`,
  `import {
  CompanyAutopopulateResponse,
  CompanyLookupResponse,
  CrmCompany,
  DashboardWidget,
  CrmConnector,
  OpenDataSignalsResponse,
} from '@bidstack/shared';`
);

// 3. Add service import after the queue import
content = content.replace(
  `import { enqueueApolloEnrich } from '../queues/company-enrich-apollo.js';`,
  `import { enqueueApolloEnrich } from '../queues/company-enrich-apollo.js';
import {
  buildDashboardSnapshot,
  serializeCompany,
  serializeWidget,
  normalizeName,
  normalizeDomain,
  normalizeRegistryValue,
  attribution,
  domainFor,
  websiteFor,
  logoUrlFor,
} from '../services/crm/dashboard.service.js';`
);

// 4. Update buildDashboardSnapshot calls to pass prisma and logger
content = content.replace(
  /buildDashboardSnapshot\(req\.auth\.orgId\)/g,
  'buildDashboardSnapshot(req.auth.orgId, undefined, prisma, req.log)'
);

fs.writeFileSync(CRM_PATH, content);
console.log('Updated', CRM_PATH);
