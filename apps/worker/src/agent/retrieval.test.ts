// Retrieval is the half of the compliance proposer that decides whether a
// requirement can be assessed at all. These tests pin the two answers that
// matter: a real page-ranged context, and an honest UNAVAILABLE — never a
// substituted chunk and never an invented citation.
//
// No database. The fake below implements the same narrow port `prisma`
// satisfies structurally, and records every where-clause so the org pin can be
// asserted rather than assumed.

import { describe, expect, it } from 'vitest';

import {
  chunkIndexById,
  formatPageRange,
  formatSourceContext,
  pageRangeOf,
  retrieveMatrixRowContext,
  retrieveRequirementContext,
  type RetrievalClient,
  type RetrievedChunk,
} from './retrieval.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';
const VERSION = '33333333-3333-3333-3333-333333333333';

type SeedChunk = RetrievedChunk & { orgId: string; documentVersionId: string };

interface Seed {
  matrixRows?: {
    id: string;
    orgId: string;
    requirementId: string;
    opportunityId: string | null;
    answerDraft: string | null;
  }[];
  requirements?: {
    id: string;
    orgId: string;
    opportunityId: string | null;
    text: string;
    mandatory: boolean;
    sourceChunkId: string | null;
    documentVersionId: string | null;
  }[];
  chunks?: SeedChunk[];
  versions?: { id: string; orgId: string; versionNo: number; title: string }[];
}

function chunk(overrides: Partial<SeedChunk> & { id: string; chunkIndex: number }): SeedChunk {
  return {
    orgId: ORG,
    documentVersionId: VERSION,
    pageStart: null,
    pageEnd: null,
    sectionPath: null,
    text: 'text',
    ...overrides,
  };
}

function makeClient(seed: Seed): { db: RetrievalClient; wheres: Record<string, unknown>[] } {
  const wheres: Record<string, unknown>[] = [];
  const db: RetrievalClient = {
    complianceMatrixRow: {
      async findFirst({ where }) {
        wheres.push(where);
        return (
          (seed.matrixRows ?? []).find((r) => r.id === where.id && r.orgId === where.orgId) ?? null
        );
      },
    },
    requirement: {
      async findFirst({ where }) {
        wheres.push(where);
        return (
          (seed.requirements ?? []).find((r) => r.id === where.id && r.orgId === where.orgId) ??
          null
        );
      },
    },
    sourceChunk: {
      async findFirst({ where }) {
        wheres.push(where);
        return (
          (seed.chunks ?? []).find((c) => c.id === where.id && c.orgId === where.orgId) ?? null
        );
      },
      async findMany({ where, take }) {
        wheres.push(where);
        return (seed.chunks ?? [])
          .filter(
            (c) =>
              c.orgId === where.orgId &&
              c.documentVersionId === where.documentVersionId &&
              c.id !== where.id.not &&
              c.chunkIndex >= where.chunkIndex.gte &&
              c.chunkIndex <= where.chunkIndex.lte,
          )
          .sort((a, b) => a.chunkIndex - b.chunkIndex)
          .slice(0, take);
      },
    },
    documentVersion: {
      async findFirst({ where }) {
        wheres.push(where);
        const found = (seed.versions ?? []).find(
          (v) => v.id === where.id && v.orgId === where.orgId,
        );
        return found
          ? { id: found.id, versionNo: found.versionNo, bidDocument: { title: found.title } }
          : null;
      },
    },
  };
  return { db, wheres };
}

const REQ_WITH_CHUNK = {
  id: 'req-1',
  orgId: ORG,
  opportunityId: 'opp-1',
  text: 'All personal data shall be processed within the EU.',
  mandatory: true,
  sourceChunkId: 'chunk-5',
  documentVersionId: VERSION,
};

const FULL_SEED: Seed = {
  matrixRows: [
    { id: 'row-1', orgId: ORG, requirementId: 'req-1', opportunityId: 'opp-1', answerDraft: null },
  ],
  requirements: [REQ_WITH_CHUNK],
  chunks: [
    chunk({ id: 'chunk-4', chunkIndex: 4, pageStart: 11, pageEnd: 11, text: 'Preceding clause.' }),
    chunk({
      id: 'chunk-5',
      chunkIndex: 5,
      pageStart: 12,
      pageEnd: 12,
      sectionPath: '§4.2 Data Protection',
      text: 'The Supplier shall process all personal data within the EU/EEA.',
    }),
    chunk({ id: 'chunk-6', chunkIndex: 6, pageStart: 13, pageEnd: 13, text: 'Following clause.' }),
    chunk({ id: 'chunk-9', chunkIndex: 9, pageStart: 20, pageEnd: 20, text: 'Far away.' }),
  ],
  versions: [{ id: VERSION, orgId: ORG, versionNo: 2, title: 'Invitation to Tender' }],
};

describe('retrieveRequirementContext — the assessable path', () => {
  it('returns the anchor chunk, its neighbours, the document and a page range', async () => {
    const { db } = makeClient(FULL_SEED);

    const context = await retrieveRequirementContext(db, { orgId: ORG, requirementId: 'req-1' });

    expect(context.assessable).toBe(true);
    expect(context.unavailableReason).toBeNull();
    expect(context.chunk?.id).toBe('chunk-5');
    expect(context.neighbours.map((c) => c.id)).toEqual(['chunk-4', 'chunk-6']);
    expect(context.document).toEqual({
      documentVersionId: VERSION,
      versionNo: 2,
      title: 'Invitation to Tender',
    });
    expect(context.pageRange).toEqual({ start: 11, end: 13 });
  });

  it('does not reach past the neighbour radius', async () => {
    const { db } = makeClient(FULL_SEED);
    const context = await retrieveRequirementContext(db, { orgId: ORG, requirementId: 'req-1' });
    expect(context.neighbours.map((c) => c.id)).not.toContain('chunk-9');
  });

  it('pins orgId into every where-clause it issues', async () => {
    const { db, wheres } = makeClient(FULL_SEED);
    await retrieveMatrixRowContext(db, { orgId: ORG, matrixRowId: 'row-1' });

    expect(wheres).toHaveLength(5); // row, requirement, chunk, neighbours, version
    for (const where of wheres) {
      expect(where).toMatchObject({ orgId: ORG });
    }
  });

  it('will not read another org’s requirement even with the right id', async () => {
    const { db } = makeClient(FULL_SEED);
    const context = await retrieveRequirementContext(db, {
      orgId: OTHER_ORG,
      requirementId: 'req-1',
    });
    expect(context.assessable).toBe(false);
    expect(context.unavailableReason).toBe('requirement-not-found');
  });
});

describe('retrieveRequirementContext — UNAVAILABLE, never invented', () => {
  it('a null sourceChunkId yields UNAVAILABLE with no chunk to cite', async () => {
    const { db } = makeClient({
      ...FULL_SEED,
      requirements: [{ ...REQ_WITH_CHUNK, sourceChunkId: null }],
    });

    const context = await retrieveRequirementContext(db, { orgId: ORG, requirementId: 'req-1' });

    expect(context.assessable).toBe(false);
    expect(context.unavailableReason).toBe('no-source-chunk');
    expect(context.chunk).toBeNull();
    expect(context.neighbours).toEqual([]);
    expect(context.document).toBeNull();
    expect(context.pageRange).toBeNull();
    // The requirement itself still comes back — "we could not look" is a
    // statement about our data, not a reason to lose the requirement.
    expect(context.requirement?.id).toBe('req-1');
    // Nothing to cite: chunkIndexById is empty, so no chunk id can be named.
    expect(chunkIndexById(context).size).toBe(0);
    expect(formatSourceContext(context)).toBe('');
  });

  it('a dangling chunk link is UNAVAILABLE, not a fallback to a nearby chunk', async () => {
    const { db } = makeClient({
      ...FULL_SEED,
      chunks: (FULL_SEED.chunks ?? []).filter((c) => c.id !== 'chunk-5'),
    });

    const context = await retrieveRequirementContext(db, { orgId: ORG, requirementId: 'req-1' });

    expect(context.assessable).toBe(false);
    expect(context.unavailableReason).toBe('chunk-not-found');
    expect(context.chunk).toBeNull();
    expect(context.neighbours).toEqual([]);
  });

  it('a chunk owned by another org is dangling, not readable', async () => {
    const { db } = makeClient({
      ...FULL_SEED,
      chunks: (FULL_SEED.chunks ?? []).map((c) =>
        c.id === 'chunk-5' ? { ...c, orgId: OTHER_ORG } : c,
      ),
    });

    const context = await retrieveRequirementContext(db, { orgId: ORG, requirementId: 'req-1' });
    expect(context.unavailableReason).toBe('chunk-not-found');
  });

  it('a missing matrix row reports itself and never invents a requirement', async () => {
    const { db } = makeClient(FULL_SEED);
    const { matrixRow, context } = await retrieveMatrixRowContext(db, {
      orgId: ORG,
      matrixRowId: 'row-does-not-exist',
    });
    expect(matrixRow).toBeNull();
    expect(context.unavailableReason).toBe('matrix-row-not-found');
    expect(context.requirement).toBeNull();
  });
});

describe('page ranges and the source block', () => {
  it('collapses a single page and spans a real range', () => {
    expect(formatPageRange({ start: 12, end: 12 })).toBe('page 12');
    expect(formatPageRange({ start: 11, end: 13 })).toBe('pages 11-13');
    expect(formatPageRange(null)).toBe('page unknown');
  });

  it('reports no range when nothing carries a page number', () => {
    expect(pageRangeOf([chunk({ id: 'a', chunkIndex: 1 })])).toBeNull();
  });

  it('labels the anchor, names the document and carries the id the model must echo', async () => {
    const { db } = makeClient(FULL_SEED);
    const context = await retrieveRequirementContext(db, { orgId: ORG, requirementId: 'req-1' });

    const block = formatSourceContext(context);

    expect(block).toContain('[ANCHOR id=chunk-5] Invitation to Tender (v2), page 12, §4.2');
    expect(block).toContain('[NEARBY id=chunk-4]');
    expect(block).toContain('The Supplier shall process all personal data within the EU/EEA.');
    // Anchor first: the model reads the requirement's own chunk as primary.
    expect(block.indexOf('chunk-5')).toBeLessThan(block.indexOf('chunk-4'));
  });

  it('indexes exactly the chunks that were retrieved, anchor included', async () => {
    const { db } = makeClient(FULL_SEED);
    const context = await retrieveRequirementContext(db, { orgId: ORG, requirementId: 'req-1' });
    expect([...chunkIndexById(context).keys()].sort()).toEqual(['chunk-4', 'chunk-5', 'chunk-6']);
  });
});
