// Crew kit — TypeScript port of CrewAI's core structure (Agent / Task / Crew /
// Process), tuned for the BidStack RFP workflow. The downloaded CrewAI source
// (Python) is the semantic reference; this is a faithful, lean TS port.
//
// An Agent is a role persona (role + goal + backstory) realised entirely through
// the prompt — there is no per-role model endpoint. A Task is a unit of work
// owned by an agent. A Crew runs tasks either sequentially (each task's output
// chains into the next) or hierarchically (a manager agent consolidates).

export type CrewProcess = 'sequential' | 'hierarchical';

/** A role-playing agent. Mirrors CrewAI's Agent(role, goal, backstory, tools). */
export interface CrewAgentDef {
  /** Stable key referenced by tasks, e.g. 'legal' | 'finance' | 'marketing'. */
  id: string;
  /** Job title / responsibility, e.g. "Legal Counsel". */
  role: string;
  /** Primary objective for this agent. */
  goal: string;
  /** Context + expertise narrative that shapes the agent's voice. */
  backstory: string;
  /** Optional names of MCP/CRM tools the agent may use (resolved by the executor). */
  tools?: string[];
}

/** A unit of work. Mirrors CrewAI's Task(description, expected_output, agent, context). */
export interface CrewTaskDef {
  /** Stable key referenced by other tasks' `context`. */
  id: string;
  /** What to accomplish. Supports {{var}} templating from kickoff inputs. */
  description: string;
  /** Success criteria / output shape, e.g. "3 bullet points". */
  expectedOutput: string;
  /** The agent responsible for this task. */
  agentId: string;
  /**
   * IDs of earlier tasks whose outputs are fed in as context. When omitted, the
   * task receives ALL prior task outputs (CrewAI's sequential default).
   */
  context?: string[];
}

/** A team of agents executing tasks under a process. Mirrors CrewAI's Crew. */
export interface CrewDef {
  agents: CrewAgentDef[];
  tasks: CrewTaskDef[];
  process: CrewProcess;
  /** Hierarchical only: the agent that consolidates. Defaults to a synthesized manager. */
  managerAgentId?: string;
}

/** Result of running a single task. */
export interface TaskResult {
  taskId: string;
  agentId: string;
  output: string;
  /** false when the agent execution failed and a fail-open placeholder was used. */
  ok: boolean;
  error?: string;
}

/** Result of a full crew run. */
export interface KickoffResult {
  process: CrewProcess;
  results: TaskResult[];
  /** Last task output (sequential) or the manager's consolidation (hierarchical). */
  finalOutput: string;
  /** true when every task executed without falling back to a placeholder. */
  ok: boolean;
}

/**
 * Abstracts the LLM call so the engine is testable and execution-substrate
 * agnostic (Dust today, anything tomorrow). The engine renders the full prompt;
 * the executor only runs it. Implementations MUST be fail-open: on any failure
 * return `{ ok: false }` with a placeholder output rather than throwing, so one
 * agent's failure never aborts the whole crew.
 */
export interface AgentExecutor {
  run(input: {
    agent: CrewAgentDef;
    task: CrewTaskDef;
    /** Fully-rendered prompt (persona + task + context). */
    prompt: string;
    inputs: Record<string, string>;
    /** Cooperative cancellation signal for queue-backed runs. */
    signal?: AbortSignal;
  }): Promise<{ output: string; ok: boolean; error?: string }>;
}
