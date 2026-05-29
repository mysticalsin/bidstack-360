/**
 * rfp-agent.schemas.ts — Zod schemas and TypeScript types for the RFP agent system.
 *
 * Extracted from rfp-agent.ts (BS-R1 file-size refactor).
 * Import via @bidstack/shared (re-exported from rfp-agent.ts barrel).
 */
import { z } from 'zod';

export const RFP_RESPONSE_PHASE_IDS = [
  'opportunity_qualification',
  'document_intake',
  'solicitation_deep_read',
  'compliance_matrix',
  'red_flags',
  'solution_strategy',
  'pricing_commercial',
  'legal_review',
  'security_privacy',
  'draft_response',
  'color_team_review',
  'submission_readiness',
  'post_submission',
] as const;

export const RfpResponsePhase = z.enum(RFP_RESPONSE_PHASE_IDS);
export type RfpResponsePhase = z.infer<typeof RfpResponsePhase>;

export const AgentProvider = z.enum(['dust', 'claude']);
export type AgentProvider = z.infer<typeof AgentProvider>;

export const AgentConfig = z
  .object({
    provider: AgentProvider.default('dust'),
    phase: RfpResponsePhase.optional(),
    templateId: z.string().min(1).max(100).optional(),
    dustAgentId: z.string().min(1).max(200).optional(),
    model: z.string().min(1).max(200).optional(),
    temperature: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().min(256).max(16000).optional(),
    allowedInputScopes: z.array(z.string().min(1).max(100)).default([]),
    outputContract: z.string().min(1).max(4000).optional(),
    approvalRequired: z.boolean().default(true),
    managedBy: z.string().min(1).max(100).optional(),
  })
  .catchall(z.unknown());
export type AgentConfig = z.infer<typeof AgentConfig>;

export const RfpResponsePhaseDefinition = z.object({
  id: RfpResponsePhase,
  label: z.string(),
  purpose: z.string(),
  userDecision: z.string(),
  requiredInputs: z.array(z.string()),
  expectedOutputs: z.array(z.string()),
  redFlagChecks: z.array(z.string()),
  gate: z.string(),
});
export type RfpResponsePhaseDefinition = z.infer<typeof RfpResponsePhaseDefinition>;

export const RfpAgentTemplate = z.object({
  id: z.string(),
  phase: RfpResponsePhase,
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  tools: z.array(z.record(z.unknown())),
  defaultConfig: AgentConfig,
});
export type RfpAgentTemplate = z.infer<typeof RfpAgentTemplate>;

export const RfpAgentTemplateListResult = z.object({
  phases: z.array(RfpResponsePhaseDefinition),
  templates: z.array(RfpAgentTemplate),
});
export type RfpAgentTemplateListResult = z.infer<typeof RfpAgentTemplateListResult>;

export const RfpAgentTemplateProvisionRequest = z.object({
  name: z.string().min(1).max(255).optional(),
  provider: AgentProvider.optional(),
  dustAgentId: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(200).optional(),
  enabledTools: z.array(z.string().min(1).max(100)).optional(),
});
export type RfpAgentTemplateProvisionRequest = z.infer<typeof RfpAgentTemplateProvisionRequest>;
