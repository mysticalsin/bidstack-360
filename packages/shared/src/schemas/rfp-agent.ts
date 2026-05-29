// Barrel — re-exports all RFP agent definitions from sub-modules.
// Extracted into four files (BS-R1 file-size refactor):
//   rfp-agent.schemas.ts       — Zod schemas + TypeScript types (~85 lines)
//   rfp-agent.phases.ts        — RFP_RESPONSE_PHASES data (13 phases, ~360 lines)
//   rfp-agent.queue-configs.ts — RfpQueueAgentConfig + RFP_QUEUE_AGENT_CONFIGS (~100 lines)
//   rfp-agent.templates.ts     — commonTools + templateConfig + RFP_AGENT_TEMPLATES (~210 lines)
//
// All callers continue to import from '@bidstack/shared' or this path unchanged.
export * from './rfp-agent.schemas.js';
export * from './rfp-agent.phases.js';
export * from './rfp-agent.queue-configs.js';
export * from './rfp-agent.templates.js';
