import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decryptSecretMock, integrationConfigFindFirstMock } = vi.hoisted(() => ({
  decryptSecretMock: vi.fn(),
  integrationConfigFindFirstMock: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    integrationConfig: {
      findFirst: integrationConfigFindFirstMock,
    },
  },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, code = 'P2002') {
        super(message);
        this.code = code;
      }
    },
  },
}));

vi.mock('@bidstack/shared/server-crypto', () => ({
  decryptSecret: decryptSecretMock,
}));

import { resolveHubSpotAccessToken } from './migration.js';

const payload = {
  migrationJobId: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  source: 'HUBSPOT_OAUTH',
  entityType: 'companies',
  chunkOffset: 0,
  chunkSize: 100,
  totalRows: 10,
  mappings: { name: 'company.name' },
  dedupStrategy: 'update',
  meta: { hubspotIntegrationConfigId: '44444444-4444-4444-8444-444444444444' },
} as const;

describe('HubSpot migration credential resolution', () => {
  beforeEach(() => {
    integrationConfigFindFirstMock.mockReset();
    decryptSecretMock.mockReset();
  });

  it('loads OAuth tokens from encrypted IntegrationConfig instead of queue metadata', async () => {
    integrationConfigFindFirstMock.mockResolvedValue({
      credentials: { encrypted: 'ciphertext' },
    });
    decryptSecretMock.mockReturnValue(JSON.stringify({ accessToken: 'hubspot-access-token' }));

    await expect(resolveHubSpotAccessToken(payload)).resolves.toBe('hubspot-access-token');

    expect(integrationConfigFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: '44444444-4444-4444-8444-444444444444',
        orgId: '22222222-2222-4222-8222-222222222222',
        type: 'hubspot',
        name: 'hubspot-migration',
        isActive: true,
        deletedAt: null,
      },
      select: { credentials: true },
    });
    expect(decryptSecretMock).toHaveBeenCalledWith('ciphertext');
  });

  it('fails loudly when the referenced HubSpot credential is unavailable', async () => {
    integrationConfigFindFirstMock.mockResolvedValue(null);

    await expect(resolveHubSpotAccessToken(payload)).rejects.toThrow(/HubSpot not connected/);
  });
});
