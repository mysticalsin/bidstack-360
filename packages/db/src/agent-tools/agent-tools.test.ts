// Shared agent tool registry: one definition, served by the MCP server and by
// Jarvis. These checks run without a database. They pin the contract both
// surfaces rely on: every tool declares the RBAC permission Jarvis checks,
// reads and writes are told apart, and every write can describe its exact
// change before it runs (the confirmation card shows that preview).
import { describe, expect, it } from 'vitest';

import { AGENT_TOOL_NAMES, activityText, agentTools, movedText } from './index.js';

describe('shared agent tool registry', () => {
  it('exposes the Jarvis read and write tools under stable names', () => {
    for (const name of [
      'records.resolve',
      'account.updates',
      'proposal.status',
      'rfp.summary',
      'bids.overdue',
      'opportunities.list',
      'opportunities.get',
      'tasks.create',
      'opportunity.update',
      'proposal.section_draft',
      'account_direction',
      'account_hiring',
      'account_financials_summary',
      'account_news',
      'consulting_partners',
    ]) {
      expect(AGENT_TOOL_NAMES).toContain(name);
    }
  });

  it('declares a description, a JSON schema and an RBAC permission per tool', () => {
    for (const name of AGENT_TOOL_NAMES) {
      const tool = agentTools[name];
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputJsonSchema.type).toBe('object');
      expect(tool.permission).toMatch(/^[a-z-]+:(read|write)$/);
      expect(['read', 'write']).toContain(tool.kind);
    }
  });

  it('keeps permission verbs aligned with read or write kind', () => {
    for (const name of AGENT_TOOL_NAMES) {
      const tool = agentTools[name];
      expect(tool.permission.endsWith(`:${tool.kind}`)).toBe(true);
    }
  });

  it('gives every write tool a preview so a human sees the exact change first', () => {
    const writes = AGENT_TOOL_NAMES.filter((n) => agentTools[n].kind === 'write');
    expect(writes).toEqual(
      expect.arrayContaining(['tasks.create', 'opportunity.update', 'proposal.section_draft']),
    );
    for (const name of writes) {
      expect(typeof agentTools[name].preview).toBe('function');
    }
  });

  it('validates write input before anything reaches the database', () => {
    const bad = agentTools['tasks.create'].input.safeParse({ oppId: 'not-a-uuid', title: '' });
    expect(bad.success).toBe(false);
  });
});

describe('timeline text helpers shared with the opportunity timeline route', () => {
  it('prefers subject, then a capped description, then the stage move', () => {
    expect(activityText({ type: 'call', subject: 'Kickoff', description: 'x', body: {} })).toBe(
      'Kickoff',
    );
    const long = 'a'.repeat(130);
    expect(activityText({ type: 'note', subject: null, description: long, body: {} })).toBe(
      `${'a'.repeat(120)}…`,
    );
    expect(
      activityText({
        type: 'stage_change',
        subject: null,
        description: null,
        body: { fromStage: 's1_lead', toStage: 's2_sent' },
      }),
    ).toBe('Moved from S1 Lead to S2 Sent');
  });

  it('reads legacy from/to keys', () => {
    expect(movedText({ from: 's1_ongoing', to: 'closed_won' })).toBe(
      'Moved from S1 Ongoing to Closed Won',
    );
  });
});
