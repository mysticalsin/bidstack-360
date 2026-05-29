/**
 * erp.service.ts — re-export barrel (BS-R1 file-size refactor).
 *
 * The ERP service now lives in focused sub-files:
 *   erp.helpers.ts         — Zod schemas, types, and pure utility functions
 *   erp.kit.service.ts     — buildPresalesKit
 *   erp.partners.service.ts — searchErpPartners, searchLocalCompanies
 *
 * This file is preserved as the public API surface so the route layer
 * (routes/erp-integration.ts) needs no changes.
 *
 * Import DAG: helpers (leaf) ← kit/partners ← this barrel.
 */

export {
  ErpBidModule,
  ErpPresalesKit,
  ErpCompanySuggestion,
  CompanyAutocompleteQuery,
  type CompanyAutocompleteInput,
  type CompanySuggestion,
  asUrl,
  normalizeDomain,
  mergeSuggestions,
  safeErrorMessage,
} from './erp.helpers.js';

export { buildPresalesKit } from './erp.kit.service.js';

export { searchErpPartners, searchLocalCompanies } from './erp.partners.service.js';
