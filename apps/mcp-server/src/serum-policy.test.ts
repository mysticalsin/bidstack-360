import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpAuthCtx } from './auth.js';
import { assertSerumAllowsMcpToolCall } from './serum-policy.js';

const { checkSerumToolRuntimePolicyMock } = vi.hoisted(() => ({
  checkSerumToolRuntimePolicyMock: vi.fn(),
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { tools: 'registry' },
  checkSerumToolRuntimePolicy: checkSerumToolRuntimePolicyMock,
}));

const ctx: McpAuthCtx = {
  orgId: '00000000-0000-0000-0000-000000000001',
  keyId: 'key-1',
  scopes: ['mcp', 'read', 'write'],
};

describe('SERUM MCP policy guard', () => {
  beforeEach(() => {
    checkSerumToolRuntimePolicyMock.mockReset();
  });

  it('allows a tool call only when the active SERUM Tools policy allows it', async () => {
    checkSerumToolRuntimePolicyMock.mockResolvedValueOnce({
      allowed: true,
      status: 'allowed',
      reason: 'Tool call is allowed by the active SERUM policy.',
      activeConfigVersionId: '00000000-0000-0000-0000-000000000002',
    });

    await expect(assertSerumAllowsMcpToolCall(ctx, 'opportunities.list')).resolves.toBeUndefined();
    expect(checkSerumToolRuntimePolicyMock).toHaveBeenCalledWith({
      orgId: ctx.orgId,
      environment: 'dev',
      configKey: 'registry',
      toolName: 'opportunities.list',
      dryRun: true,
    });
  });

  it('fails closed when SERUM denies the tool', async () => {
    checkSerumToolRuntimePolicyMock.mockResolvedValueOnce({
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Tools policy is published.',
      activeConfigVersionId: null,
    });

    await expect(assertSerumAllowsMcpToolCall(ctx, 'opportunity.update')).rejects.toThrow(
      'SERUM runtime denied tool "opportunity.update": No active SERUM Tools policy is published.',
    );
  });
});
