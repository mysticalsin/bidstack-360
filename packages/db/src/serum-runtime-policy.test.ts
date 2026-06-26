import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configFindFirst: vi.fn(),
  connectionTestCreate: vi.fn(),
  connectionTestFindFirst: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('./index.js', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    serumConfigVersion: {
      findFirst: mocks.configFindFirst,
    },
    serumConnectorConnectionTest: {
      create: mocks.connectionTestCreate,
      findFirst: mocks.connectionTestFindFirst,
    },
  },
}));

import {
  checkSerumConnectorRuntimePolicy,
  checkSerumDustMcpGatewayRuntimePolicy,
  checkSerumModelRouterRuntimePolicy,
  checkSerumToolRuntimePolicy,
  recordSerumConnectorConnectionTest,
} from './serum-runtime-policy.js';

const orgId = '00000000-0000-4000-8000-000000000001';
const activeConfigVersionId = '00000000-0000-4000-8000-000000000099';

function connectorConfig(configJson: Record<string, unknown> = {}) {
  return {
    id: activeConfigVersionId,
    configType: 'connectors',
    configKey: 'registry',
    version: 1,
    configJson: {
      enabled: true,
      connectorMode: 'read_only',
      requireConnectionTest: true,
      secretRefs: ['connector:odoo-prod'],
      ...configJson,
    },
  };
}

function toolConfig(configJson: Record<string, unknown> = {}) {
  return {
    id: activeConfigVersionId,
    configType: 'tools',
    configKey: 'registry',
    version: 1,
    configJson: {
      enabled: true,
      registryMode: 'explicit_allowlist',
      allowedTools: ['opportunities.list'],
      allowWriteTools: false,
      requireDryRunForWriteTools: true,
      ...configJson,
    },
  };
}

function dustMcpGatewayConfig(configJson: Record<string, unknown> = {}) {
  return {
    id: activeConfigVersionId,
    configType: 'dust_mcp_gateway',
    configKey: 'gateway',
    version: 1,
    configJson: {
      dustEnabled: true,
      mcpEnabled: false,
      writeMode: 'disabled',
      secretRefs: ['dust:production'],
      requireToolAudit: true,
      ...configJson,
    },
  };
}

function modelRouterConfig(configJson: Record<string, unknown> = {}) {
  return {
    id: activeConfigVersionId,
    configType: 'model_router',
    configKey: 'routing',
    version: 1,
    configJson: {
      defaultProvider: 'gemma',
      fallbackProvider: null,
      maxTokensPerRequest: 2000,
      requireSourceCitations: true,
      uncertaintyMode: 'answer_with_limits',
      ...configJson,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRaw.mockResolvedValue([]);
  mocks.configFindFirst.mockImplementation(({ where }: { where: { configType: string } }) =>
    where.configType === 'connectors' ? connectorConfig() : null,
  );
  mocks.connectionTestFindFirst.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000123',
  });
});

describe('SERUM connector connection-test evidence', () => {
  it('requires a fresh success evidence row when the active connector policy requires testing', async () => {
    mocks.connectionTestFindFirst.mockResolvedValueOnce(null);

    const decision = await checkSerumConnectorRuntimePolicy({
      orgId,
      environment: 'dev',
      configKey: 'registry',
      connectorId: 'Odoo',
      operation: 'erp.search',
      writeRequested: false,
    });

    expect(decision).toMatchObject({
      allowed: false,
      status: 'denied',
      reason: 'Connector execution requires connection-test evidence.',
      subject: 'erp.search:odoo',
    });
    expect(mocks.connectionTestFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId,
          environment: 'dev',
          connectorId: 'odoo',
          status: 'success',
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    );
    expect(mocks.configFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('allows read execution when fresh connector evidence exists', async () => {
    const decision = await checkSerumConnectorRuntimePolicy({
      orgId,
      environment: 'dev',
      configKey: 'registry',
      connectorId: 'odoo',
      operation: 'erp.search',
      writeRequested: false,
    });

    expect(decision).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'erp.search:odoo',
      activeConfigVersionId,
    });
    expect(mocks.configFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.configFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId,
          environment: 'dev',
          configType: 'connectors',
          configKey: 'registry',
        }),
      }),
    );
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('allows explicit connection probes to create evidence before prior evidence exists', async () => {
    mocks.connectionTestFindFirst.mockResolvedValueOnce(null);

    const decision = await checkSerumConnectorRuntimePolicy({
      orgId,
      environment: 'dev',
      configKey: 'registry',
      connectorId: 'odoo',
      operation: 'erp.status',
      writeRequested: false,
      connectionTestProbe: true,
    });

    expect(decision).toMatchObject({ allowed: true, status: 'allowed' });
    expect(mocks.connectionTestFindFirst).not.toHaveBeenCalled();
    expect(mocks.configFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('records connection-test success with a 30-day expiration by default', async () => {
    await recordSerumConnectorConnectionTest({
      orgId,
      environment: 'production',
      connectorId: 'Slack',
      operation: 'slack.oauth.callback',
      testedByUserId: '00000000-0000-4000-8000-000000000002',
      evidence: { teamId: 'T123' },
    });

    expect(mocks.connectionTestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId,
        environment: 'production',
        connectorId: 'slack',
        operation: 'slack.oauth.callback',
        status: 'success',
        evidence: { teamId: 'T123' },
      }),
    });
    const data = mocks.connectionTestCreate.mock.calls[0]?.[0]?.data as {
      testedAt: Date;
      expiresAt: Date;
    };
    expect(data.expiresAt.getTime() - data.testedAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('SERUM hot-path runtime guards', () => {
  it('checks MCP tool calls with only the active tools policy', async () => {
    mocks.configFindFirst.mockImplementation(({ where }: { where: { configType: string } }) =>
      where.configType === 'tools' ? toolConfig() : null,
    );

    const decision = await checkSerumToolRuntimePolicy({
      orgId,
      environment: 'dev',
      configKey: 'registry',
      toolName: 'opportunities.list',
      dryRun: false,
    });

    expect(decision).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'opportunities.list',
      activeConfigVersionId,
    });
    expect(mocks.configFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.configFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId,
          environment: 'dev',
          configType: 'tools',
          configKey: 'registry',
        }),
      }),
    );
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.connectionTestFindFirst).not.toHaveBeenCalled();
  });

  it('checks Dust gateway reads with only the active gateway policy', async () => {
    mocks.configFindFirst.mockImplementation(({ where }: { where: { configType: string } }) =>
      where.configType === 'dust_mcp_gateway' ? dustMcpGatewayConfig() : null,
    );

    const decision = await checkSerumDustMcpGatewayRuntimePolicy({
      orgId,
      environment: 'production',
      configKey: 'gateway',
      operation: 'dust.workspace.list',
      writeRequested: false,
      toolAuditPresent: true,
    });

    expect(decision).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'dust.workspace.list',
      activeConfigVersionId,
    });
    expect(mocks.configFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.configFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId,
          environment: 'production',
          configType: 'dust_mcp_gateway',
          configKey: 'gateway',
        }),
      }),
    );
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.connectionTestFindFirst).not.toHaveBeenCalled();
  });

  it('checks explicit Gemma model routes without org-provider or credential side queries', async () => {
    mocks.configFindFirst.mockImplementation(({ where }: { where: { configType: string } }) =>
      where.configType === 'model_router' ? modelRouterConfig() : null,
    );

    const decision = await checkSerumModelRouterRuntimePolicy({
      orgId,
      environment: 'dev',
      configKey: 'routing',
      provider: 'gemma',
      requestedMaxTokens: 1000,
      sourceCitationsRequired: true,
    });

    expect(decision).toMatchObject({
      allowed: true,
      status: 'allowed',
      subject: 'gemma',
      activeConfigVersionId,
    });
    expect(mocks.configFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.configFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId,
          environment: 'dev',
          configType: 'model_router',
          configKey: 'routing',
        }),
      }),
    );
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.connectionTestFindFirst).not.toHaveBeenCalled();
  });
});
