import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@bidstack/db';

vi.mock('@bidstack/db', () => ({ prisma: {} }));
vi.mock('./feature-extraction.js', () => ({
  extractLeadFeatures: vi.fn(),
  extractOpportunityFeatures: vi.fn(),
}));
vi.mock('./trainer-xgboost.js', () => ({ trainWithXgboost: vi.fn() }));

const { trainOrgModel } = await import('./trainer.js');

describe('trainOrgModel', () => {
  it('stores no model when the org has fewer than 50 closed leads', async () => {
    // Why: a short history used to train on synthetic rows and look like this org's model.
    const db = {
      lead: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await expect(trainOrgModel('org-1', 'lead', db)).resolves.toBeNull();
  });

  it('stores no model when the org has fewer than 50 closed opportunities', async () => {
    const db = {
      opportunity: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await expect(trainOrgModel('org-1', 'opportunity', db)).resolves.toBeNull();
  });
});
