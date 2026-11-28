import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/client/index.js';

import { SAMPLE_SIGNALS, seedSampleSignals } from './seed-signals.js';

/**
 * Fixture watchdog rows stay sample=true and source 'sample'. The catalog
 * headline is what a seller reads. A "Sample:" prefix or "Sample data."
 * rationale tells them the workspace is still a demo.
 */
describe('seedSampleSignals seller-facing copy', () => {
  it('writes the catalog headline and a reference-record rationale, and keeps the fixture keys', async () => {
    const writes: Array<{
      where: { orgId_source_externalId: { orgId: string; source: string; externalId: string } };
      create: { title: string; source: string; sourceUrl: string; sample: boolean; externalId: string };
      update: { title: string; implicationRationale: string; sample: boolean; sourceUrl: string; payload: { sample: boolean } };
    }> = [];
    const prisma = {
      company: { findMany: vi.fn(async () => [{ id: 'co-1', orgId: 'org-1' }]) },
      accountWatchEvent: {
        upsert: vi.fn(async (args: (typeof writes)[number]) => {
          writes.push(args);
          return {};
        }),
      },
    };

    const result = await seedSampleSignals(prisma as unknown as PrismaClient, { now: new Date('2026-11-01T00:00:00.000Z') });

    const headline = SAMPLE_SIGNALS['CI Financial']![0]!.title;
    expect(headline).toBe('CI Financial third-quarter profit rose 12% on record assets');
    expect(headline).not.toMatch(/^Sample:/i);

    expect(result.upserted).toBe(writes.length);
    expect(writes.length).toBe(Object.values(SAMPLE_SIGNALS).reduce((n, rows) => n + rows.length, 0));

    for (const signals of Object.values(SAMPLE_SIGNALS)) {
      for (const s of signals) {
        const w = writes.find((row) => row.where.orgId_source_externalId.externalId === `sample:${s.slug}:co-1`);
        expect(w, s.slug).toBeTruthy();
        expect(w!.where.orgId_source_externalId).toMatchObject({ orgId: 'org-1', source: 'sample' });
        expect(w!.create).toMatchObject({ source: 'sample', externalId: `sample:${s.slug}:co-1`, sourceUrl: '', sample: true });
        expect(w!.update.sample).toBe(true);
        expect(w!.update.sourceUrl).toBe('');
        expect(w!.update.payload.sample).toBe(true);
        // Seller-facing: the stored title is the headline, and the rationale is a reference record.
        expect(w!.create.title, s.slug).toBe(s.title);
        expect(w!.update.title, s.slug).toBe(s.title);
        expect(w!.create.title, s.slug).not.toMatch(/^Sample:\s/i);
        expect(w!.update.implicationRationale, s.slug).toMatch(/^Reference record\. Classified by .+\.$/);
        expect(w!.update.implicationRationale, s.slug).not.toMatch(/Sample/);
      }
    }
  });
});
