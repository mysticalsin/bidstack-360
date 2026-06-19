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
