// Crew execution engine — the kickoff() loop ported from CrewAI semantics.
//
// Pure + executor-injected so it is fully unit-testable without a live LLM.
// Two failure philosophies, deliberately different:
//   - DEFINITION errors (bad agentId, forward/missing context ref) FAIL LOUD —
//     validateCrew throws, because a malformed crew is a programming error.
//   - EXECUTION errors FAIL OPEN — a task whose agent call fails gets a
//     placeholder output + ok:false and the crew CONTINUES, matching the rest
//     of the platform's fail-open Dust pattern. The caller inspects per-task ok.

import type {
  AgentExecutor,
  CrewAgentDef,
  CrewDef,
  CrewTaskDef,
  KickoffResult,
  TaskResult,
} from './types.js';

export interface KickoffOptions {
  signal?: AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const err = new Error('crew run cancelled');
  err.name = 'AbortError';
  throw err;
}

/** Replace {{ var }} placeholders from the inputs map (CrewAI-style). Unknown
 *  vars collapse to empty string so a missing input never leaks "{{x}}" to the
 *  LLM. Only flat [A-Za-z0-9_] keys are supported — dotted/nested keys such as
 *  {{client.name}} are NOT interpolated (they collapse to ''). */
export function renderTemplate(text: string, inputs: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => inputs[key] ?? '');
}

// Per-context-block ceiling. Without this, a sequential crew with no explicit
// `context` accumulates every prior output into each later prompt (O(N²) growth),
// which can blow the model's context window and Dust token cost. Truncating each
// block bounds it; callers wanting tighter control set an explicit `context`.
const MAX_CONTEXT_CHARS = 8000;

/**
 * Validate a crew definition. Throws on any structural error so a broken crew
 * surfaces immediately instead of producing silently-wrong output.
 */
export function validateCrew(crew: CrewDef): void {
  if (!crew.agents.length) throw new Error('crew: at least one agent is required');
  if (!crew.tasks.length) throw new Error('crew: at least one task is required');

  const agentIds = new Set(crew.agents.map((a) => a.id));
  if (agentIds.size !== crew.agents.length) {
    throw new Error('crew: duplicate agent id');
  }

  const seenTaskIds = new Set<string>();
  for (const task of crew.tasks) {
    if (seenTaskIds.has(task.id)) throw new Error(`crew: duplicate task id "${task.id}"`);
    if (!agentIds.has(task.agentId)) {
      throw new Error(`crew: task "${task.id}" references unknown agent "${task.agentId}"`);
    }
    if (task.context && new Set(task.context).size !== task.context.length) {
      throw new Error(`crew: task "${task.id}" has duplicate context ids`);
    }
    for (const ctxId of task.context ?? []) {
      // Context may only reference a task defined EARLIER — prevents forward refs + cycles.
      if (!seenTaskIds.has(ctxId)) {
        throw new Error(
          `crew: task "${task.id}" context references "${ctxId}", which is not an earlier task`,
        );
      }
    }
    seenTaskIds.add(task.id);
  }

  // NOTE: unlike CrewAI (which forbids the manager from being in the agents
  // list), this v1 treats the manager as a normal agent that runs the
  // consolidation task — so managerAgentId MUST be a defined agent. Intentional
  // inversion; don't "fix" it to match CrewAI without revisiting the v1 model.
  if (
    crew.process === 'hierarchical' &&
    crew.managerAgentId &&
    !agentIds.has(crew.managerAgentId)
  ) {
    throw new Error(`crew: managerAgentId "${crew.managerAgentId}" is not a defined agent`);
  }
}

/**
 * Build the full prompt for a task: agent persona + the task + any context.
 *
 * WHY no escaping: the persona, templated description, and prior-task outputs are
 * interpolated raw. Prior-task `output` is LLM-generated, so a task could in
 * theory emit text that mimics a context header or injects instructions. This is
 * accepted for v1 because crews are org-internal, the agents have no tool side
 * effects, and every output sits behind the human approval gate. Revisit if/when
 * crew agents gain tool-calling.
 */
export function buildTaskPrompt(
  agent: CrewAgentDef,
  task: CrewTaskDef,
  contextResults: TaskResult[],
  inputs: Record<string, string>,
): string {
  const description = renderTemplate(task.description, inputs);
  const expected = renderTemplate(task.expectedOutput, inputs);
  const lines = [
    `You are ${agent.role}.`,
    `Your goal: ${agent.goal}`,
    `Your background: ${agent.backstory}`,
    '',
    `Task: ${description}`,
    `Expected output: ${expected}`,
  ];
  if (contextResults.length > 0) {
    lines.push('', 'Context from previous steps:');
    for (const c of contextResults) {
      const output =
        c.output.length > MAX_CONTEXT_CHARS
          ? `${c.output.slice(0, MAX_CONTEXT_CHARS)}\n…[truncated]`
          : c.output;
      lines.push(`--- ${c.taskId} (${c.agentId}) ---`, output);
    }
  }
  return lines.join('\n');
}

function agentById(crew: CrewDef, id: string): CrewAgentDef {
  const agent = crew.agents.find((a) => a.id === id);
  // Guaranteed by validateCrew; the throw is a defensive invariant.
  if (!agent) throw new Error(`crew: agent "${id}" not found`);
  return agent;
}

/** Resolve the context results for a task: explicit `context` ids, else all prior. */
function contextFor(task: CrewTaskDef, completed: TaskResult[]): TaskResult[] {
  if (task.context) {
    const byId = new Map(completed.map((r) => [r.taskId, r]));
    return task.context.map((id) => byId.get(id)).filter((r): r is TaskResult => Boolean(r));
  }
  return completed;
}

async function runTask(
  crew: CrewDef,
  task: CrewTaskDef,
  completed: TaskResult[],
  inputs: Record<string, string>,
  executor: AgentExecutor,
  signal?: AbortSignal,
): Promise<TaskResult> {
  throwIfAborted(signal);
  const agent = agentById(crew, task.agentId);
  const prompt = buildTaskPrompt(agent, task, contextFor(task, completed), inputs);
  const res = await executor.run({ agent, task, prompt, inputs, signal });
  throwIfAborted(signal);
  return { taskId: task.id, agentId: agent.id, output: res.output, ok: res.ok, error: res.error };
}

async function kickoffSequential(
  crew: CrewDef,
  inputs: Record<string, string>,
  executor: AgentExecutor,
  options: KickoffOptions = {},
): Promise<KickoffResult> {
  const results: TaskResult[] = [];
  for (const task of crew.tasks) {
    // Sequential by design: each task's output feeds the next.
    results.push(await runTask(crew, task, results, inputs, executor, options.signal));
  }
  return {
    process: 'sequential',
    results,
    finalOutput: results[results.length - 1]?.output ?? '',
    ok: results.every((r) => r.ok),
  };
}

const SYNTHESIZED_MANAGER: CrewAgentDef = {
  id: '__manager__',
  role: 'Crew Manager',
  goal: 'Consolidate the specialists’ work into one coherent, decision-ready result.',
  backstory:
    'An experienced bid manager who reviews each specialist’s contribution, resolves conflicts, and produces the final answer.',
};

async function kickoffHierarchical(
  crew: CrewDef,
  inputs: Record<string, string>,
  executor: AgentExecutor,
  options: KickoffOptions = {},
): Promise<KickoffResult> {
  // v1 hierarchical models the process as "sequential workers, then a manager
  // consolidation" — which is NOT how CrewAI delegates. Two deliberate
  // divergences from CrewAI: (1) workers run themselves and chain prior outputs
  // (CrewAI's manager would delegate each task and workers wouldn't autonomously
  // chain); (2) the final __consolidation__ step is a port invention (CrewAI's
  // final output is simply the last task). Full delegation/validation loops are
  // out of scope for v1.
  const results: TaskResult[] = [];
  for (const task of crew.tasks) {
    // Ordered so the manager later sees a stable, complete record.
    results.push(await runTask(crew, task, results, inputs, executor, options.signal));
  }

  const manager = crew.managerAgentId ? agentById(crew, crew.managerAgentId) : SYNTHESIZED_MANAGER;
  const consolidationTask: CrewTaskDef = {
    id: '__consolidation__',
    description:
      'Review every specialist contribution above and produce the final, coherent result. ' +
      'Resolve any contradictions and keep only what belongs in the deliverable.',
    expectedOutput: 'The final consolidated deliverable.',
    agentId: manager.id,
  };
  const managerPrompt = buildTaskPrompt(manager, consolidationTask, results, inputs);
  const managerRes = await executor.run({
    agent: manager,
    task: consolidationTask,
    prompt: managerPrompt,
    inputs,
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  const managerResult: TaskResult = {
    taskId: consolidationTask.id,
    agentId: manager.id,
    output: managerRes.output,
    ok: managerRes.ok,
    error: managerRes.error,
  };
  results.push(managerResult);

  return {
    process: 'hierarchical',
    results,
    finalOutput: managerResult.output,
    ok: results.every((r) => r.ok),
  };
}

/**
 * Run a crew. Mirrors CrewAI's crew.kickoff(inputs): validates the definition,
 * substitutes {{vars}}, chains context between tasks, and returns per-task
 * results plus the final output. Fail-open on execution; fail-loud on a bad
 * definition.
 *
 * SECURITY (caller obligation): everything in `inputs` and the task descriptions
 * is sent to the LLM. The caller MUST ensure no NDA Tier-D ("never-in-AI")
 * content enters them — mirror the isDocumentAiSafe gate the RFP extract worker
 * uses before deriving any crew input from a document.
 */
export async function kickoff(
  crew: CrewDef,
  inputs: Record<string, string>,
  executor: AgentExecutor,
  options: KickoffOptions = {},
): Promise<KickoffResult> {
  validateCrew(crew);
  throwIfAborted(options.signal);
  return crew.process === 'hierarchical'
    ? kickoffHierarchical(crew, inputs, executor, options)
    : kickoffSequential(crew, inputs, executor, options);
}
