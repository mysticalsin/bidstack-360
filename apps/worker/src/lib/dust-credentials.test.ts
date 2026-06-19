import { beforeEach, describe, expect, it, vi } from 'vitest';
import type pino from 'pino';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  dustCredentialsFromConfigRow: vi.fn(),
  dustCredentialsFromEnv: vi.fn(),
  checkGateway: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { dustMcpGateway: 'gateway' },
  checkSerumDustMcpGatewayRuntimePolicy: mocks.checkGateway,
}));

vi.mock('@bidstack/shared/server', () => ({
  dustCredentialsFromConfigRow: mocks.dustCredentialsFromConfigRow,
  dustCredentialsFromEnv: mocks.dustCredentialsFromEnv,
  resolveAgentId: vi.fn(),
  maskApiKey: vi.fn(),
}));

import { getOrgDust } from './dust-credentials.js';

const orgId = '11111111-1111-4111-8111-111111111111';
const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as pino.Logger;
const creds = {
  apiKey: 'dust-key',
  workspaceId: 'workspace-1',
  baseUrl: 'https://dust.example/api',
  dataSourceId: 'data-source-1',
  agentIds: {},
  source: 'org',
};

describe('getOrgDust SERUM gateway guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([{ config: {}, credentials: {} }]);
    mocks.dustCredentialsFromConfigRow.mockReturnValue(creds);
    mocks.dustCredentialsFromEnv.mockReturnValue(null);
    globalThis.fetch = vi.fn();
  });

  it('denies Dust agent runs before any network request when SERUM gateway rejects them', async () => {
    mocks.checkGateway.mockResolvedValue({
      configType: 'dust_mcp_gateway',
      configKey: 'gateway',
      environment: 'dev',
      subject: 'dust.runAgent',
      allowed: false,
      status: 'disabled',
      reason: 'SERUM Dust/MCP Gateway policy is published but Dust is disabled.',
      activeConfigVersionId: '22222222-2222-4222-8222-222222222222',
    });

    const { client } = await getOrgDust(orgId, log);

    await expect(client?.runAgent('agent-1', 'hello')).rejects.toThrow(
      'SERUM Dust/MCP Gateway denied dust.runAgent',
    );
    expect(mocks.checkGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId,
        environment: 'dev',
        configKey: 'gateway',
        operation: 'dust.runAgent',
        writeRequested: false,
        approvalConfirmed: false,
        toolAuditPresent: true,
      }),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('marks Dust document upserts as approval-gated writes', async () => {
    mocks.checkGateway.mockResolvedValue({
      configType: 'dust_mcp_gateway',
      configKey: 'gateway',
      environment: 'dev',
      subject: 'dust.upsertDocument',
      allowed: false,
      status: 'denied',
      reason: 'Gateway write operations require explicit approval confirmation.',
      activeConfigVersionId: '22222222-2222-4222-8222-222222222222',
    });

    const { client } = await getOrgDust(orgId, log);

    await expect(client?.upsertDocument('ds', 'doc-1', 'body')).rejects.toThrow(
      'SERUM Dust/MCP Gateway denied dust.upsertDocument',
    );
    expect(mocks.checkGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'dust.upsertDocument',
        writeRequested: true,
        approvalConfirmed: false,
      }),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
