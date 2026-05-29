// Barrel — re-exports all queue configuration from sub-modules.
// Extracted into three files (BS-R1 file-size refactor):
//   queue-config.core.ts        — interfaces + 8 core queues
//   queue-config.integrations.ts — Wave 4–8 integration + ML queues
//   queue-config.rfp.ts          — Wave 9 RFP Automation Engine queues
//
// All import paths that use '@bidstack/shared' (or this file directly)
// continue to work without change — the public API is identical.
export * from './queue-config.core.js';
export * from './queue-config.integrations.js';
export * from './queue-config.rfp.js';
