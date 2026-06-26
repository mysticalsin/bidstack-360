// Shared provider-selection + audit wrapper for every RFP AI step.
//
// One place decides which model answers an RFP step and records the AI-audit
// trail. Tiering: direct LLM (SERUM-allowed org/env provider) or Dust when no
// direct provider is selected, then null. A null return means the call was not
// configured, denied, or errored; the caller then applies its own deterministic
// fallback (placeholder draft, zero QA score, PARTIAL compliance).
//
// WHY a helper: requirement-extract, section-draft, qa-review, compliance-fill
// and the legal/review crew all ran the same Dust-or-fallback block. Centralising
// it means a new provider (or audit field) is wired once, not five times, and the
// deterministic fallback contract is identical everywhere. The API key is never logged.

import type pino from 'pino';
import type { DustClient } from '@bidstack/dust-client';

import { logAiInvocation } from './ai-audit-worker.js';
import {
  SERUM_RUNTIME_CONFIG_KEYS,
  checkSerumModelRouterRuntimePolicy,
  checkSerumPromptLibraryRuntimePolicy,
} from '@bidstack/db/serum-runtime-policy';
import { resolveLlmFromEnv, completeChat, type LlmProviderKind } from './llm-provider.js';
import { resolveOrgLlm } from './org-llm.js';

export interface RfpCompletionOpts {
  orgId: string;
  log: pino.Logger;
  /** Dust client for the org, or null. Used only on the Dust tier. */
  dust: DustClient | null;
  /** Dust agent id for the Dust tier (ignored by direct providers). */
  agentId: string;
  /** Full prompt — role preamble + instructions + content (built by the caller). */
  userMessage: string;
  /** System prompt for direct chat providers (Dust uses the agent's own instructions). */
  system?: string;
  /** Audit label, e.g. 'rfp-qa-review'. */
  agentType: string;
  traceId?: string;
  /** Force JSON for direct chat providers (extract/QA/compliance); omit for Markdown steps. */
  responseFormat?: 'json_object' | 'text';
  /** Max output tokens for direct chat providers (Markdown drafts need more than the default). */
  maxTokens?: number;
  /** Whether this model step is expected to preserve source citation behavior. */
  sourceCitationsRequired?: boolean;
  /** SERUM Prompt Library prompt set id; defaults to agentType for source-controlled RFP prompts. */
  promptSet?: string;
  /** Source-controlled prompt templates are versioned by code review unless a caller overrides this. */
  versionedPrompt?: boolean;
  /** Source-controlled RFP prompts are covered by prompt-safety regressions unless overridden. */
  promptInjectionTested?: boolean;
  /** True when the prompt set is release-approved for production execution. */
  productionApproved?: boolean;
  /** Cooperative cancellation from queue-backed jobs. */
  signal?: AbortSignal;
}

export interface RfpCompletionResult {
  text: string;
  /** 'openai' | 'anthropic' | 'moonshot' | 'nim' | 'gemma' | 'dust' */
  provider: string;
  /** Dust run id when the Dust tier answered; undefined otherwise. */
  runId?: string;
}

const DIRECT_LLM_DEFAULT_MAX_TOKENS = 4096;

function defaultSerumConfigEnvironment(): 'dev' | 'staging' | 'production' {
  const env = process.env.SERUM_CONFIG_ENVIRONMENT;
  if (env === 'staging' || env === 'production') return env;
  return 'dev';
}

function directProviderIdForKind(kind: LlmProviderKind): string {
  switch (kind) {
    case 'anthropic':
      return 'claude';
    case 'moonshot':
      return 'kimi';
    case 'nim':
      return 'nvidia_nim';
    default:
      return kind;
  }
}

async function ensurePromptLibraryAllowed(args: {
  orgId: string;
  log: pino.Logger;
  environment: 'dev' | 'staging' | 'production';
  operation: string;
  promptSet: string;
  versionedPrompt: boolean;
  injectionTested: boolean;
  productionApproved: boolean;
  model: string;
  userMessage: string;
  traceId?: string;
  startedAt: number;
}): Promise<boolean> {
  try {
    const decision = await checkSerumPromptLibraryRuntimePolicy({
      orgId: args.orgId,
      environment: args.environment,
      configKey: SERUM_RUNTIME_CONFIG_KEYS.promptLibrary,
      operation: args.operation,
      promptSet: args.promptSet,
      versionedPrompt: args.versionedPrompt,
      injectionTested: args.injectionTested,
      productionApproved: args.productionApproved,
    });
    if (decision.allowed) return true;

    args.log.warn(
      { agentType: args.operation, promptSet: args.promptSet, reason: decision.reason },
      'rfp-llm: SERUM prompt library denied model call',
    );
    await logAiInvocation(
      {
        orgId: args.orgId,
        agentType: args.operation,
        model: args.model,
        prompt: args.userMessage,
        response: '',
        tokenCount: 0,
        durationMs: Date.now() - args.startedAt,
        status: 'error',
        errorMsg: `SERUM prompt library denied model call: ${decision.reason}`.slice(0, 500),
        traceId: args.traceId,
      },
      args.log,
    );
    return false;
  } catch (err) {
    args.log.warn(
      { err, agentType: args.operation, promptSet: args.promptSet },
      'rfp-llm: SERUM prompt library check failed, returning deterministic fallback',
    );
    await logAiInvocation(
      {
        orgId: args.orgId,
        agentType: args.operation,
        model: args.model,
        prompt: args.userMessage,
        response: '',
        tokenCount: 0,
        durationMs: Date.now() - args.startedAt,
        status: 'error',
        errorMsg: `SERUM prompt library check failed: ${(err as Error).message}`.slice(0, 500),
        traceId: args.traceId,
      },
      args.log,
    );
    return false;
  }
}

/**
 * Run one RFP completion against the configured provider. Returns null when no
 * provider is configured or the call failed (caller falls back deterministically).
 * Emits exactly one AI-audit record (success or error) for the attempt.
 */
export async function runRfpCompletion(
  opts: RfpCompletionOpts,
): Promise<RfpCompletionResult | null> {
  const {
    orgId,
    log,
    dust,
    agentId,
    userMessage,
    system,
    agentType,
    traceId,
    responseFormat,
    maxTokens,
    sourceCitationsRequired = true,
    promptSet = agentType,
    versionedPrompt = true,
    promptInjectionTested = true,
    productionApproved = true,
    signal,
  } = opts;
  const environment = defaultSerumConfigEnvironment();
  // Per-org provider (chosen in Settings) wins over the deployment-wide env
  // provider, so a tenant can switch vendors without a redeploy.
  const directLlm = (await resolveOrgLlm(orgId)) ?? resolveLlmFromEnv();

  // ── Tier 1: direct LLM provider (GPT / Claude / Kimi / NIM / Gemma) ──────────
  if (directLlm) {
    const t0 = Date.now();
    const promptAllowed = await ensurePromptLibraryAllowed({
      orgId,
      log,
      environment,
      operation: agentType,
      promptSet,
      versionedPrompt,
      injectionTested: promptInjectionTested,
      productionApproved,
      model: `${directLlm.kind}:${directLlm.model}`,
      userMessage,
      traceId,
      startedAt: t0,
    });
    if (!promptAllowed) return null;

    let modelRoute: Awaited<ReturnType<typeof checkSerumModelRouterRuntimePolicy>>;
    try {
      modelRoute = await checkSerumModelRouterRuntimePolicy({
        orgId,
        environment,
        configKey: SERUM_RUNTIME_CONFIG_KEYS.modelRouter,
        provider: directProviderIdForKind(directLlm.kind),
        requestedMaxTokens: maxTokens ?? DIRECT_LLM_DEFAULT_MAX_TOKENS,
        sourceCitationsRequired,
      });
    } catch (err) {
      log.warn(
        { err, provider: directLlm.kind, agentType },
        'rfp-llm: SERUM model router check failed, returning deterministic fallback',
      );
      await logAiInvocation(
        {
          orgId,
          agentType,
          model: `${directLlm.kind}:${directLlm.model}`,
          prompt: userMessage,
          response: '',
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'error',
          errorMsg: `SERUM model router check failed: ${(err as Error).message}`.slice(0, 500),
          traceId,
        },
        log,
      );
      return null;
    }
    if (!modelRoute.allowed) {
      log.warn(
        { provider: directLlm.kind, agentType, reason: modelRoute.reason },
        'rfp-llm: SERUM model router denied provider call',
      );
      await logAiInvocation(
        {
          orgId,
          agentType,
          model: `${directLlm.kind}:${directLlm.model}`,
          prompt: userMessage,
          response: '',
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'error',
          errorMsg: `SERUM model router denied provider call: ${modelRoute.reason}`.slice(0, 500),
          traceId,
        },
        log,
      );
      return null;
    }

    try {
      const text = await completeChat(directLlm, {
        system,
        user: userMessage,
        responseFormat,
        maxTokens,
        signal,
      });
      await logAiInvocation(
        {
          orgId,
          agentType,
          model: `${directLlm.kind}:${directLlm.model}`,
          prompt: userMessage,
          response: text,
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'success',
          traceId,
        },
        log,
      );
      return { text, provider: directLlm.kind };
    } catch (err) {
      if (signal?.aborted) throw err;
      log.warn(
        { err, provider: directLlm.kind, agentType },
        'rfp-llm: provider call failed, returning deterministic fallback',
      );
      await logAiInvocation(
        {
          orgId,
          agentType,
          model: `${directLlm.kind}:${directLlm.model}`,
          prompt: userMessage,
          response: '',
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'error',
          errorMsg: (err as Error).message?.slice(0, 500),
          traceId,
        },
        log,
      );
      return null;
    }
  }

  // ── Tier 2: Dust agent (per-org or global workspace) ────────────────────────
  if (dust) {
    const t0 = Date.now();
    const promptAllowed = await ensurePromptLibraryAllowed({
      orgId,
      log,
      environment,
      operation: agentType,
      promptSet,
      versionedPrompt,
      injectionTested: promptInjectionTested,
      productionApproved,
      model: 'dust',
      userMessage,
      traceId,
      startedAt: t0,
    });
    if (!promptAllowed) return null;

    try {
      const run = await dust.runAgent(agentId, userMessage, { signal });
      const text = run.output?.trim() ?? '';
      if (run.status !== 'succeeded' || !text) {
        throw new Error(`Dust agent run failed: ${run.status}`);
      }
      await logAiInvocation(
        {
          orgId,
          agentType,
          model: 'dust',
          prompt: userMessage,
          response: text,
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'success',
          traceId,
        },
        log,
      );
      return { text, provider: 'dust', runId: run.run_id };
    } catch (err) {
      if (signal?.aborted) throw err;
      log.warn({ err, agentType }, 'rfp-llm: Dust call failed, falling back');
      await logAiInvocation(
        {
          orgId,
          agentType,
          model: 'dust',
          prompt: userMessage,
          response: '',
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'error',
          errorMsg: (err as Error).message?.slice(0, 500),
          traceId,
        },
        log,
      );
      return null;
    }
  }

  // ── Tier 3: nothing configured ──────────────────────────────────────────────
  return null;
}
