// Crew engine unit tests. A recording mock executor stands in for the LLM so we
// assert structure (context chaining, templating, fail-open, hierarchy) with no
// network. This is the contract the Dust executor must honour.

import { describe, expect, it } from 'vitest';

import { kickoff, renderTemplate, validateCrew, buildTaskPrompt } from './engine.js';
import type { AgentExecutor, CrewDef } from './types.js';

/** Mock executor: echoes a deterministic output and records every prompt it saw. */
function recordingExecutor(opts: { failTaskIds?: string[] } = {}): {
  executor: AgentExecutor;
  prompts: Record<string, string>;
} {
  const prompts: Record<string, string> = {};
  const fail = new Set(opts.failTaskIds ?? []);
  const executor: AgentExecutor = {
    run: async ({ task, prompt }) => {
      prompts[task.id] = prompt;
      if (fail.has(task.id)) {
        return { output: `[placeholder ${task.id}]`, ok: false, error: 'mock_fail' };
      }
      return { output: `out:${task.id}`, ok: true };
    },
  };
  return { executor, prompts };
}

const AGENTS = [
  { id: 'analyst', role: 'Analyst', goal: 'analyse', backstory: 'expert analyst' },
  { id: 'writer', role: 'Writer', goal: 'write', backstory: 'expert writer' },
  { id: 'manager', role: 'Manager', goal: 'consolidate', backstory: 'bid manager' },
];

describe('renderTemplate', () => {
  it('substitutes {{var}} and collapses unknown vars to empty', () => {
    expect(
      renderTemplate('Research {{topic}} for {{client}}', { topic: 'AI', client: 'Acme' }),
    ).toBe('Research AI for Acme');
    expect(renderTemplate('Hello {{missing}}!', {})).toBe('Hello !');
  });
});

describe('validateCrew', () => {
  it('throws when a task references an unknown agent', () => {
    const crew: CrewDef = {
      agents: [AGENTS[0]!],
      tasks: [{ id: 't1', description: 'x', expectedOutput: 'y', agentId: 'ghost' }],
      process: 'sequential',
    };
    expect(() => validateCrew(crew)).toThrow(/unknown agent/);
  });

  it('throws on a forward/missing context reference', () => {
    const crew: CrewDef = {
      agents: [AGENTS[0]!],
      tasks: [
        { id: 't1', description: 'x', expectedOutput: 'y', agentId: 'analyst', context: ['t2'] },
        { id: 't2', description: 'x', expectedOutput: 'y', agentId: 'analyst' },
      ],
      process: 'sequential',
    };
    expect(() => validateCrew(crew)).toThrow(/not an earlier task/);
  });

  it('throws on duplicate task ids', () => {
    const crew: CrewDef = {
      agents: [AGENTS[0]!],
      tasks: [
        { id: 't1', description: 'x', expectedOutput: 'y', agentId: 'analyst' },
        { id: 't1', description: 'x', expectedOutput: 'y', agentId: 'analyst' },
      ],
      process: 'sequential',
    };
    expect(() => validateCrew(crew)).toThrow(/duplicate task id/);
  });

  it('throws on duplicate context ids within a task', () => {
    const crew: CrewDef = {
      agents: [AGENTS[0]!],
      tasks: [
        { id: 't1', description: 'x', expectedOutput: 'y', agentId: 'analyst' },
        {
          id: 't2',
          description: 'x',
          expectedOutput: 'y',
          agentId: 'analyst',
          context: ['t1', 't1'],
        },
      ],
      process: 'sequential',
    };
    expect(() => validateCrew(crew)).toThrow(/duplicate context ids/);
  });

  it('throws on a self-referencing context', () => {
    const crew: CrewDef = {
      agents: [AGENTS[0]!],
      tasks: [
        { id: 't1', description: 'x', expectedOutput: 'y', agentId: 'analyst', context: ['t1'] },
      ],
      process: 'sequential',
    };
    expect(() => validateCrew(crew)).toThrow(/not an earlier task/);
  });
});

describe('buildTaskPrompt', () => {
  it('includes the agent persona, the task, and context outputs', () => {
    const prompt = buildTaskPrompt(
      AGENTS[1]!,
      {
        id: 't2',
        description: 'Draft the {{section}}',
        expectedOutput: 'prose',
        agentId: 'writer',
      },
      [{ taskId: 't1', agentId: 'analyst', output: 'PRIOR_FINDINGS', ok: true }],
      { section: 'summary' },
    );
    expect(prompt).toContain('You are Writer.');
    expect(prompt).toContain('Draft the summary');
    expect(prompt).toContain('PRIOR_FINDINGS');
  });
});

describe('kickoff — sequential', () => {
  const crew: CrewDef = {
    agents: AGENTS,
    tasks: [
      {
        id: 't1',
        description: 'Analyse {{topic}}',
        expectedOutput: 'findings',
        agentId: 'analyst',
      },
      { id: 't2', description: 'Draft from findings', expectedOutput: 'draft', agentId: 'writer' },
    ],
    process: 'sequential',
  };

  it('chains every prior output into the next task by default', async () => {
    const { executor, prompts } = recordingExecutor();
    const res = await kickoff(crew, { topic: 'security' }, executor);

    expect(res.process).toBe('sequential');
    expect(res.ok).toBe(true);
    expect(res.results.map((r) => r.taskId)).toEqual(['t1', 't2']);
    // t1's description was templated...
    expect(prompts.t1).toContain('Analyse security');
    // ...and t2 saw t1's output as context (default = all prior).
    expect(prompts.t2).toContain('out:t1');
    // final output is the last task's output
    expect(res.finalOutput).toBe('out:t2');
  });

  it('respects an explicit context allow-list', async () => {
    const threeTask: CrewDef = {
      agents: AGENTS,
      tasks: [
        { id: 't1', description: 'a', expectedOutput: 'o', agentId: 'analyst' },
        { id: 't2', description: 'b', expectedOutput: 'o', agentId: 'analyst' },
        // t3 only wants t1's context, not t2's
        { id: 't3', description: 'c', expectedOutput: 'o', agentId: 'writer', context: ['t1'] },
      ],
      process: 'sequential',
    };
    const { executor, prompts } = recordingExecutor();
    await kickoff(threeTask, {}, executor);
    expect(prompts.t3).toContain('out:t1');
    expect(prompts.t3).not.toContain('out:t2');
  });

  it('injects NO context for an explicit empty list (three-state: [] is not undefined)', async () => {
    const crew2: CrewDef = {
      agents: AGENTS,
      tasks: [
        { id: 't1', description: 'a', expectedOutput: 'o', agentId: 'analyst' },
        { id: 't2', description: 'b', expectedOutput: 'o', agentId: 'writer', context: [] },
      ],
      process: 'sequential',
    };
    const { executor, prompts } = recordingExecutor();
    await kickoff(crew2, {}, executor);
    expect(prompts.t2).not.toContain('Context from previous steps');
    expect(prompts.t2).not.toContain('out:t1');
  });

  it('single task: final output is that task, with no context section', async () => {
    const crew2: CrewDef = {
      agents: AGENTS,
      tasks: [{ id: 'solo', description: 'do it', expectedOutput: 'o', agentId: 'analyst' }],
      process: 'sequential',
    };
    const { executor, prompts } = recordingExecutor();
    const res = await kickoff(crew2, {}, executor);
    expect(res.finalOutput).toBe('out:solo');
    expect(prompts.solo).not.toContain('Context from previous steps');
  });

  it('fails open: a failed task does not abort the crew', async () => {
    const { executor } = recordingExecutor({ failTaskIds: ['t1'] });
    const res = await kickoff(crew, { topic: 'x' }, executor);
    expect(res.ok).toBe(false);
    expect(res.results.find((r) => r.taskId === 't1')?.ok).toBe(false);
    // t2 still ran despite t1 failing
    expect(res.results.find((r) => r.taskId === 't2')?.ok).toBe(true);
    expect(res.finalOutput).toBe('out:t2');
  });

  it('honors an already-aborted cancellation signal before running tasks', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { executor, prompts } = recordingExecutor();

    await expect(kickoff(crew, { topic: 'x' }, executor, { signal: ctl.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(Object.keys(prompts)).toHaveLength(0);
  });

  it('passes the cancellation signal to the executor', async () => {
    const ctl = new AbortController();
    const seenSignals: Array<AbortSignal | undefined> = [];
    const executor: AgentExecutor = {
      run: async ({ task, signal }) => {
        seenSignals.push(signal);
        return { output: `out:${task.id}`, ok: true };
      },
    };

    await kickoff(crew, { topic: 'x' }, executor, { signal: ctl.signal });

    expect(seenSignals).toEqual([ctl.signal, ctl.signal]);
  });
});

describe('kickoff — hierarchical', () => {
  const crew: CrewDef = {
    agents: AGENTS,
    tasks: [
      { id: 't1', description: 'Legal scan', expectedOutput: 'risks', agentId: 'analyst' },
      { id: 't2', description: 'Pricing', expectedOutput: 'price', agentId: 'writer' },
    ],
    process: 'hierarchical',
    managerAgentId: 'manager',
  };

  it('runs all tasks then a manager consolidation as the final output', async () => {
    const { executor, prompts } = recordingExecutor();
    const res = await kickoff(crew, {}, executor);

    expect(res.process).toBe('hierarchical');
    // worker tasks + one consolidation task
    expect(res.results.map((r) => r.taskId)).toEqual(['t1', 't2', '__consolidation__']);
    // the manager saw both worker outputs
    expect(prompts.__consolidation__).toContain('out:t1');
    expect(prompts.__consolidation__).toContain('out:t2');
    expect(res.finalOutput).toBe('out:__consolidation__');
  });

  it('synthesizes a default manager when none is named', async () => {
    const { executor } = recordingExecutor();
    const res = await kickoff({ ...crew, managerAgentId: undefined }, {}, executor);
    expect(res.results.at(-1)?.agentId).toBe('__manager__');
  });

  it('fails open: a failed worker still runs the manager consolidation', async () => {
    const { executor } = recordingExecutor({ failTaskIds: ['t1'] });
    const res = await kickoff(crew, {}, executor);
    expect(res.ok).toBe(false);
    expect(res.results.find((r) => r.taskId === 't1')?.ok).toBe(false);
    expect(res.results.at(-1)?.taskId).toBe('__consolidation__');
    expect(res.finalOutput).toBe('out:__consolidation__');
  });
});
