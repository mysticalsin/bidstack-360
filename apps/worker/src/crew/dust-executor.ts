// Dust-backed AgentExecutor for the crew engine.
//
// Realises a crew Agent persona through a single Dust agent endpoint: the
// engine builds the full role+goal+backstory+task prompt and we hand it to
// Dust. Fail-open throughout — no key, a failed run, or a thrown error all
// resolve to { ok: false } with a readable placeholder so one agent never
// aborts the crew (the caller inspects per-task ok).

import type pino from 'pino';

import { DustClient } from '@bidstack/dust-client';

import type { AgentExecutor } from './types.js';

/** Dust agent id used to execute crew personas. Configurable; falls back to a
 *  conventional default so local/dev runs work once a key is present. */
const DUST_CREW_AGENT_ID = process.env.DUST_CREW_AGENT_ID ?? 'rfp-crew-agent';

function getDustClient(log: pino.Logger): DustClient | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) {
    log.warn('crew: DUST_API_KEY / DUST_WORKSPACE_ID not set — crew runs return placeholders');
    return null;
  }
  return new DustClient({ apiKey, workspaceId, logger: log });
}

export function createDustExecutor(log: pino.Logger): AgentExecutor {
  return {
    async run({ agent, prompt }) {
      const dust = getDustClient(log);
      if (!dust) {
        return {
          output: `[crew] ${agent.role}: LLM not configured — placeholder output.`,
          ok: false,
          error: 'dust_not_configured',
        };
      }
      try {
        const run = await dust.runAgent(DUST_CREW_AGENT_ID, prompt);
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
