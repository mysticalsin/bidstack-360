/**
 * Consulting partners (slice 15). Pure logic and contracts shared by the
 * API, the worker, the MCP server, the seed and the web app.
 */
export * from './types.js';
export * from './firms.js';
export * from './classify.js';
export * from './records.js';
export * from './positioning.js';
export { createHashKey as partnerEvidenceKey } from './hash.js';
