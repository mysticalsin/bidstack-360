// One definition, two surfaces. The MCP catalog must serve the exact tool
// objects Jarvis runs, not copies, so a fix to a handler or schema reaches
// both. Scopes must follow the shared read/write kind so an MCP read key can
// never reach a tool Jarvis treats as a write.
import { describe, expect, it } from 'vitest';

import { AGENT_TOOL_NAMES, agentTools } from '@bidstack/db/agent-tools';

import { toolScopes, tools } from './index.js';

describe('MCP registry reuses the shared agent tools', () => {
  it('registers every shared tool by identity', () => {
    for (const name of AGENT_TOOL_NAMES) {
      expect(tools[name as keyof typeof tools]).toBe(agentTools[name]);
    }
  });

  it('maps the shared kind onto the MCP scope', () => {
    for (const name of AGENT_TOOL_NAMES) {
      expect(toolScopes[name as keyof typeof toolScopes]).toBe(agentTools[name].kind);
    }
  });

  it('serves the account intelligence tools from the shared registry', () => {
    for (const name of [
      'account_direction',
      'account_hiring',
      'account_financials_summary',
      'account_news',
    ] as const) {
      expect(AGENT_TOOL_NAMES).toContain(name);
      expect(tools[name]).toBe(agentTools[name]);
      expect(toolScopes[name]).toBe('read');
    }
  });
});
