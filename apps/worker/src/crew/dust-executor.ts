// Provider-backed AgentExecutor for the crew engine.
//
// Realises a crew Agent persona through the shared RFP provider wrapper:
// direct provider (NIM/OpenAI/Anthropic/Kimi/Gemma) first, then one Dust agent.
// Fail-open throughout: no key, a failed run, or a thrown error resolves to
// { ok: false } with a readable placeholder so one agent never aborts the crew.

import type pino from 'pino';

import { getOrgDust, resolveAgentId } from '../lib/dust-credentials.js';
import { resolveLlmFromEnv } from '../lib/llm-provider.js';
import { runRfpCompletion } from '../lib/rfp-llm.js';
import type { AgentExecutor } from './types.js';

/** Conventional fallback agent id when neither the org config nor env sets one. */
const DEFAULT_CREW_AGENT_ID = 'rfp-crew-agent';

/**
 * Build an executor for one org. Dust credentials are resolved once here (org
 * IntegrationConfig first, DUST_* env fallback). Direct providers are resolved
 * from env by runRfpCompletion, so Agent Studio can run on NVIDIA NIM without a
 * Dust workspace.
 */
export async function createDustExecutor(log: pino.Logger, orgId: string): Promise<AgentExecutor> {
  const { client: dust, creds } = await getOrgDust(orgId, log);
  const crewAgentId =
    resolveAgentId(creds, 'crew', process.env.DUST_CREW_AGENT_ID) ?? DEFAULT_CREW_AGENT_ID;
  if (!dust) {
    log.warn(
      { orgId, directProvider: Boolean(resolveLlmFromEnv()) },
      'crew: no Dust credentials for org',
    );
  }

  return {
    async run({ agent, prompt, signal }) {
      if (!dust && !resolveLlmFromEnv()) {
        return {
          output: `[crew] ${agent.role}: LLM not configured - placeholder output.`,
          ok: false,
          error: 'llm_not_configured',
        };
      }

      const completion = await runRfpCompletion({
        orgId,
        log,
        dust,
        agentId: crewAgentId,
        userMessage: prompt,
        agentType: `crew-${agent.id}`,
        responseFormat: 'text',
        maxTokens: 8000,
        signal,
      });

      if (!completion) {
        return {
          output: `[crew] ${agent.role}: agent unavailable - manual review required.`,
          ok: false,
          error: 'llm_unavailable',
        };
      }

      return { output: completion.text, ok: true };
    },
  };
}
