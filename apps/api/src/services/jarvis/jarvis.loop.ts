/**
 * Jarvis agentic loop. Plans with the org's LLM (same resolver and budget cap
 * as the Copilot routes) or, when none is configured, the deterministic demo
 * planner. Tools come from the shared registry (@bidstack/db/agent-tools).
 *
 * Guarantees: reads run after an RBAC check; writes are staged as pending
 * actions and never executed here; every tool call writes one audit row;
 * the loop stops at JARVIS_MAX_STEPS; tool output and answers are capped.
 */
import type { Logger as PinoLogger } from 'pino';

import { prisma } from '@bidstack/db';
import { AGENT_TOOL_NAMES, agentTools, type AgentToolName } from '@bidstack/db/agent-tools';
import type { PermissionKey } from '@bidstack/shared';

import { logAiInvocation } from '../../lib/ai-audit.js';
import { userHasPermission } from '../../lib/rbac-decision-cache.js';
import {
  checkDailyCap,
  completeChatOrNull,
  estimateCost,
  recordCost,
  resolveActiveLlm,
} from '../ai-assistant.helpers.js';

import { collectCitations, collectMissing, composeAnswer, summarizeStep } from './jarvis.answer.js';
import { nextFallbackTurn } from './jarvis.fallback.js';
import {
  MAX_ANSWER_CHARS,
  buildSystemPrompt,
  buildTurnPrompt,
  capText,
  parseModelTurn,
  type PromptTool,
} from './jarvis.prompt.js';
import { saveRun, stageAction } from './jarvis.store.js';
import type {
  JarvisContext,
  JarvisRunView,
  JarvisStep,
  JarvisToolResult,
  JarvisTurn,
} from './jarvis.types.js';

export const JARVIS_MAX_STEPS = 6;
const TOOL_TIMEOUT_MS = 10_000;
const SUMMARY_CHARS = 200;

type LlmFn = (args: { system: string; user: string }) => Promise<string | null>;

let testLlm: LlmFn | null = null;

/** Test seam: stands in for the org LLM. Production callers never set it. */
export function __setJarvisLlmForTest(fn: LlmFn | null): void {
  testLlm = fn;
}

export interface JarvisRunInput {
  runId: string;
  orgId: string;
  userId: string;
  message: string;
  context: JarvisContext;
  log: PinoLogger;
}

const PROMPT_TOOLS: PromptTool[] = AGENT_TOOL_NAMES.map((name) => ({
  name,
  description: agentTools[name].description,
  kind: agentTools[name].kind,
  schema: agentTools[name].inputJsonSchema,
}));

function isToolName(name: string): name is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(name);
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tool timed out')), TOOL_TIMEOUT_MS);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

async function auditToolCall(
  input: JarvisRunInput,
  step: JarvisStep,
  index: number,
  mode: JarvisRunView['mode'],
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        action: 'jarvis.tool_call',
        targetType: 'jarvis_run',
        targetId: input.runId,
        diff: {
          tool: step.tool,
          kind: step.kind,
          status: step.status,
          step: index + 1,
          durationMs: step.durationMs ?? null,
          mode,
        },
      },
    });
  } catch (err) {
    input.log.error({ err, tool: step.tool }, 'jarvis: audit write failed');
  }
}

async function planner(input: JarvisRunInput): Promise<{
  mode: JarvisRunView['mode'];
  llm: LlmFn | null;
  note: string | null;
}> {
  if (testLlm) return { mode: 'llm', llm: testLlm, note: null };
  const resolved = await resolveActiveLlm(input.orgId);
  if (!resolved) return { mode: 'demo', llm: null, note: null };
  const cap = await checkDailyCap(input.orgId, input.userId, input.log);
  if (!cap.allowed) {
    return { mode: 'demo', llm: null, note: 'AI budget reached, answered from records only.' };
  }
  const llm: LlmFn = async ({ system, user }) => {
    const started = Date.now();
    const text = await completeChatOrNull(
      input.orgId,
      { system, user, responseFormat: 'json_object', maxTokens: 900 },
      input.log,
    );
    const inTokens = Math.ceil((system.length + user.length) / 4);
    const outTokens = Math.ceil((text ?? '').length / 4);
    await recordCost(input.orgId, input.userId, estimateCost(inTokens, outTokens), input.log);
    await logAiInvocation({
      orgId: input.orgId,
      userId: input.userId,
      agentType: 'jarvis',
      model: resolved.model,
      prompt: user,
      response: text ?? '',
      tokenCount: inTokens + outTokens,
      durationMs: Date.now() - started,
      status: text ? 'success' : 'error',
      traceId: input.runId,
    });
    return text;
  };
  return { mode: 'llm', llm, note: null };
}

async function nextTurn(
  input: JarvisRunInput,
  llm: LlmFn | null,
  system: string,
  results: JarvisToolResult[],
): Promise<JarvisTurn | null> {
  if (!llm) {
    return nextFallbackTurn({
      message: input.message,
      context: input.context,
      results,
      now: new Date(),
    });
  }
  const raw = await llm({ system, user: buildTurnPrompt(input.message, results) });
  return raw ? parseModelTurn(raw, AGENT_TOOL_NAMES) : null;
}

async function runTool(
  input: JarvisRunInput,
  view: JarvisRunView,
  name: string,
  args: Record<string, unknown>,
): Promise<{ step: JarvisStep; result: JarvisToolResult }> {
  const started = Date.now();
  const kind = isToolName(name) ? agentTools[name].kind : 'read';
  const step: JarvisStep = {
    id: `${view.runId}:${view.steps.length + 1}`,
    tool: name,
    kind,
    status: 'running',
    summary: '',
  };
  view.steps.push(step);
  await saveRun(input, view);

  const finish = (status: JarvisStep['status'], summary: string, result: JarvisToolResult) => {
    step.status = status;
    step.summary = capText(summary, SUMMARY_CHARS);
    step.durationMs = Date.now() - started;
    return { step, result };
  };

  if (!isToolName(name)) {
    return finish('error', 'Unknown tool', { tool: name, ok: false, error: 'Unknown tool' });
  }
  const tool = agentTools[name];
  // Staging a write only reads the record; the confirm route checks the
  // write permission itself before anything changes.
  const stagePermission =
    tool.kind === 'read'
      ? tool.permission
      : (tool.permission.replace(/:write$/, ':read') as PermissionKey);
  const allowed = await userHasPermission(input.orgId, input.userId, stagePermission);
  if (!allowed) {
    return finish('denied', 'No access', { tool: name, ok: false, error: 'No access to this data' });
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    return finish('error', 'Invalid arguments', {
      tool: name,
      ok: false,
      error: 'Invalid arguments',
    });
  }
  const ctx = { orgId: input.orgId, userId: input.userId, surface: 'jarvis' as const };
  try {
    if (tool.kind === 'write') {
      if (!tool.preview) {
        return finish('error', 'No preview', { tool: name, ok: false, error: 'No preview' });
      }
      const preview = await withTimeout(tool.preview(parsed.data as never, ctx));
      const action = await stageAction({
        orgId: input.orgId,
        userId: input.userId,
        runId: view.runId,
        tool: name,
        args: parsed.data as Record<string, unknown>,
        preview,
      });
      view.pendingActions.push({ id: action.id, tool: name, ...preview });
      return finish('pending', preview.title, {
        tool: name,
        ok: true,
        output: { pending: true, actionId: action.id, preview },
      });
    }
    const output = await withTimeout(tool.handler(parsed.data as never, ctx));
    return finish('done', summarizeStep(name, output), { tool: name, ok: true, output });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool failed';
    return finish('error', message, { tool: name, ok: false, error: capText(message, 300) });
  }
}

export async function runJarvisLoop(input: JarvisRunInput, view: JarvisRunView): Promise<void> {
  const results: JarvisToolResult[] = [];
  try {
    const plan = await planner(input);
    view.mode = plan.mode;
    let llm = plan.llm;
    const system = buildSystemPrompt(PROMPT_TOOLS, input.context);

    while (view.steps.length < JARVIS_MAX_STEPS) {
      let turn = await nextTurn(input, llm, system, results);
      if (!turn && llm) {
        // Unreadable model output: finish deterministically from the tools.
        llm = null;
        turn = await nextTurn(input, null, system, results);
      }
      if (!turn) break;
      if (turn.type === 'answer') {
        const citations = collectCitations(results);
        view.answer = {
          text: capText(turn.text, MAX_ANSWER_CHARS),
          citations: turn.citations?.length ? turn.citations : citations,
          missing: [
            ...new Set([...(turn.missing ?? []), ...collectMissing(results), ...(plan.note ? [plan.note] : [])]),
          ],
        };
        break;
      }
      const { step, result } = await runTool(input, view, turn.tool, turn.args);
      results.push(result);
      await auditToolCall(input, step, view.steps.length - 1, view.mode);
      await saveRun(input, view);
    }

    if (!view.answer) {
      const base = composeAnswer(results);
      view.answer = {
        text: `I stopped at the step limit of ${JARVIS_MAX_STEPS} steps. ${base.text}`.slice(
          0,
          MAX_ANSWER_CHARS,
        ),
        citations: base.citations,
        missing: base.missing,
      };
    }
    view.status = 'done';
  } catch (err) {
    input.log.error({ err, runId: input.runId }, 'jarvis: run failed');
    view.status = 'error';
    view.answer = { text: 'Jarvis hit an error. Try again.', citations: [], missing: [] };
  }
  await saveRun(input, view);
}
