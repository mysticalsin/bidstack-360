// Barrel — re-exports all CRM schemas from sub-modules.
// Extracted into four files (BS-R1 file-size refactor):
//   crm.base.ts      — CrmObjectSource, SourceAttribution, CrmLogo, TechnicalStackCategory (~55 lines)
//   crm.entities.ts  — CrmCompany, CrmPerson, CrmDeal, CrmActivity, AiInsight (~115 lines)
//   crm.analytics.ts — SalesMetricKpi, SalesIntelligenceReport family (~135 lines)
//   crm.dashboard.ts — Dashboard, cockpit, connectors, composite schemas (~245 lines)
//
// All callers continue to import from '@bidstack/shared' or this path unchanged.
export * from './crm.base.js';
export * from './crm.entities.js';
export * from './crm.analytics.js';
export * from './crm.dashboard.js';
