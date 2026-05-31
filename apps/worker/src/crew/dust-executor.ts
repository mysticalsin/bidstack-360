// Dust-backed AgentExecutor for the crew engine.
//
// Realises a crew Agent persona through a single Dust agent endpoint: the
// engine builds the full role+goal+backstory+task prompt and we hand it to
// Dust. Fail-open throughout — no key, a failed run, or a thrown error all
// resolve to { ok: false } with a readable placeholder so one agent never
// aborts the crew (the caller inspects per-task ok).

import type pino from 'pino';

import { DustClient } from '@bidstack/dust-client';

import { resolveOrgDustCredentials, resolveAgentId } from '../lib/dust-credentials.js';
import type { AgentExecutor } from './types.js';

/** Conventional fallback agent id when neither the org config nor env sets one. */
const DEFAULT_CREW_AGENT_ID = 'rfp-crew-agent';

/**
 * Build a Dust-backed executor for one org. Credentials are resolved ONCE here
 * (org IntegrationConfig first, DUST_* env fallback) and closed over, so a crew
 * run does a single credential lookup rather than one per task. Fail-open: with
 * no credentials, every task resolves to a readable placeholder.
 */
export async function createDustExecutor(log: pino.Logger, orgId: string): Promise<AgentExecutor> {
  const creds = await resolveOrgDustCredentials(orgId);
  const dust = creds
    ? new DustClient({
        apiKey: creds.apiKey,
        workspaceId: creds.workspaceId,
        baseUrl: creds.baseUrl,
        logger: log,
      })
    : null;
  const crewAgentId =
    resolveAgentId(creds, 'crew', process.env.DUST_CREW_AGENT_ID) ?? DEFAULT_CREW_AGENT_ID;
  if (!dust) {
    log.warn({ orgId }, 'crew: no Dust credentials for org — crew runs return placeholders');
  }

  return {
    async run({ agent, prompt }) {
      if (!dust) {
        return {
          output: `[crew] ${agent.role}: LLM not configured — placeholder output.`,
          ok: false,
          error: 'dust_not_configured',
        };
      }
      try {
        const run = await dust.runAgent(crewAgentId, prompt);
        if (run.status !== 'succeeded' || !run.output) {
          log.warn({ agent: agent.id, status: run.status }, 'crew: dust run did not succeed');
          return {
            output: `[crew] ${agent.role}: agent run ${run.status}.`,
            ok: false,
            error: `dust_${run.status}`,
          };
        }
        return { output: run.output, ok: true };
      } catch (err) {
        log.warn({ agent: agent.id, err }, 'crew: dust run threw — failing open');
        return {
          output: `[crew] ${agent.role}: agent error.`,
          ok: false,
          error: err instanceof Error ? err.message.slice(0, 200) : 'dust_error',
        };
      }
    },
  };
}
