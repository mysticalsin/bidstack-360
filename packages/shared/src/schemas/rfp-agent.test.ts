import { describe, expect, it } from 'vitest';

import {
  AgentConfig,
  RFP_AGENT_TEMPLATES,
  RFP_RESPONSE_PHASES,
  RfpAgentTemplate,
  RfpResponsePhaseDefinition,
} from './rfp-agent.js';

describe('RFP response agent catalog', () => {
  it('keeps every response phase contract valid', () => {
    for (const phase of RFP_RESPONSE_PHASES) {
      expect(RfpResponsePhaseDefinition.safeParse(phase).success).toBe(true);
      expect(phase.requiredInputs.length).toBeGreaterThan(0);
      expect(phase.expectedOutputs.length).toBeGreaterThan(0);
      expect(phase.redFlagChecks.length).toBeGreaterThan(0);
    }
  });

  it('ships unique templates that point at known phases', () => {
    const ids = new Set<string>();
    const phaseIds = new Set(RFP_RESPONSE_PHASES.map((phase) => phase.id));

    for (const template of RFP_AGENT_TEMPLATES) {
      expect(RfpAgentTemplate.safeParse(template).success).toBe(true);
      expect(ids.has(template.id)).toBe(false);
      expect(phaseIds.has(template.phase)).toBe(true);
      expect(template.defaultConfig.provider).toBe('claude');
      expect(template.defaultConfig.approvalRequired).toBe(true);
      ids.add(template.id);
    }
  });

  it('covers the mandatory RFP work: intake, reading, compliance, red flags, drafting, and submission', () => {
    const coveredPhases = new Set(RFP_AGENT_TEMPLATES.map((template) => template.phase));

    expect(coveredPhases.has('document_intake')).toBe(true);
    expect(coveredPhases.has('solicitation_deep_read')).toBe(true);
    expect(coveredPhases.has('compliance_matrix')).toBe(true);
    expect(coveredPhases.has('red_flags')).toBe(true);
    expect(coveredPhases.has('draft_response')).toBe(true);
    expect(coveredPhases.has('submission_readiness')).toBe(true);
  });

  it('allows the RFP agent squad to use non-vendor-locked model providers', () => {
    for (const provider of ['dust', 'claude', 'openai', 'kimi', 'nvidia_nim', 'gemma']) {
      expect(AgentConfig.safeParse({ provider }).success).toBe(true);
    }
  });
});

