/**
 * CS service barrel — re-exports from apps/api/src/services/cs via
 * workspace alias once packages/cs is extracted.
 *
 * WHY this shim: the worker cannot import from apps/api (separate TS rootDir).
 * Until a shared @bidstack/cs package is created, the worker calls these
 * functions via this re-export file which uses the same @bidstack/db client.
 *
 * Wire-up TODO: extract apps/api/src/services/cs into packages/cs and
 * replace this file with `export * from '@bidstack/cs'`.
 */
export { computeAndPersistHealthScore } from '../../../../api/src/services/cs/health-score.service.js';
export { processRenewalOpportunities } from '../../../../api/src/services/cs/renewal.service.js';
export { sendQuarterlyNpsSurveys } from '../../../../api/src/services/cs/nps.service.js';
export { runOrgChurnDetection } from '../../../../api/src/services/cs/churn-detection.service.js';
export { surfaceExpansionOpportunities } from '../../../../api/src/services/cs/expansion.service.js';
