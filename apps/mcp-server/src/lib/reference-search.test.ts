import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkRetrieval: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { retrieval: 'policy' },
  checkSerumRetrievalRuntimePolicy: mocks.checkRetrieval,
}));

import { searchReferences } from './reference-search.js';

const orgId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

function decision(allowed: boolean) {
  return {
    configType: 'retrieval',
    configKey: 'policy',
    environment: 'dev',
    subject: 'retrieval.referenceSearch',
    allowed,
    status: allowed ? 'allowed' : 'denied',
    reason: allowed ? 'allowed' : 'denied for test',
    activeConfigVersionId: allowed ? 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' : null,
  };
}

function refRow(index: number) {
  return {
    id: `ref-${index}`,
    title: `Reference ${index}`,
    description: null,
    industry: null,
    value_micros: 1n,
    usage_count: 1,
    document_url: null,
    tags: [] as string[],
    score: 0,
  };
}

function sqlLimit(call: unknown[]): number {
  const value = [...call].reverse().find((part) => typeof part === 'number');
  if (typeof value !== 'number') throw new Error('keyword limit missing');
  return value;
}

describe('reference search SERUM retrieval policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COHERE_API_KEY = 'cohere-test-key';
    delete process.env.SERUM_CONFIG_ENVIRONMENT;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COHERE_API_KEY;
    delete process.env.SERUM_CONFIG_ENVIRONMENT;
  });

  it('does not call Cohere when SERUM denies semantic retrieval', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.checkRetrieval.mockResolvedValueOnce(decision(false));
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: 'ref-1',
        title: 'Healthcare managed services',
        description: 'Past win',
        industry: 'healthcare',
        value_micros: 1_000_000n,
        usage_count: 3,
        document_url: null,
        tags: ['healthcare'],
        score: 0,
      },
    ]);

    const result = await searchReferences(orgId, 'managed services', { limit: 3 });

    expect(result.mode).toBe('keyword');
    expect(Array.isArray(result.references)).toBe(false);
    expect(result.references.items).toHaveLength(1);
    expect(result.references).toMatchObject({ limit: 3, truncated: false });
    expect(result.references.items[0]?.valueMicros).toBe('1000000');
    expect(result.references.items[0]).not.toHaveProperty('valueEur');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.checkRetrieval).toHaveBeenCalledWith({
      orgId,
      environment: 'dev',
      configKey: 'policy',
      operation: 'retrieval.referenceSearch',
      requestedChunks: 3,
      sourceBacked: true,
      expectedConfidence: 1,
    });
  });

  it('returns a large reference amount as integer micros', async () => {
    // WHY: valueEur used to divide micros by 1e6 and name the result euros.
    // Number() also moves this amount off the cent.
    mocks.checkRetrieval.mockResolvedValueOnce(decision(false));
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: 'ref-large',
        title: 'Large delivery',
        description: null,
        industry: null,
        value_micros: 8_598_204_328_457_184_962n,
        usage_count: 1,
        document_url: null,
        tags: [],
        score: 0,
      },
    ]);

    const result = await searchReferences(orgId, 'large delivery', { limit: 1 });
    const reference = result.references.items[0];
    expect(reference?.valueMicros).toBe('8598204328457184962');
    expect(JSON.stringify(result)).not.toMatch(/valueEur|EUR|€/);
  });

  it('calls Cohere only after SERUM allows semantic retrieval', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [new Array(1024).fill(0.01)] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    mocks.checkRetrieval.mockResolvedValueOnce(decision(true));
    mocks.queryRaw.mockResolvedValueOnce([]);

    const result = await searchReferences(orgId, 'governed proposal proof', { limit: 4 });

    expect(result.mode).toBe('semantic');
    expect(result.references).toEqual({ items: [], limit: 4, truncated: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.checkRetrieval).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId,
        configKey: 'policy',
        operation: 'retrieval.referenceSearch',
        requestedChunks: 4,
      }),
    );
  });
});

describe('spotlight reference page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COHERE_API_KEY;
    delete process.env.SERUM_CONFIG_ENVIRONMENT;
  });

  afterEach(() => {
    delete process.env.COHERE_API_KEY;
  });

  it('does not return one reference as a bare array, or a full page as the whole set', async () => {
    // WHY: references were a bare array of the requested page. Dust could treat
    // that page as every match. One reference is the whole set. The extra row
    // sets truncated.
    mocks.queryRaw.mockImplementation(async () => [refRow(0)]);

    const one = await searchReferences(orgId, 'payments', { limit: 8 });
    expect(Array.isArray(one.references)).toBe(false);
    expect(one.references).toEqual({
      items: [expect.objectContaining({ id: 'ref-0', title: 'Reference 0' })],
      limit: 8,
      truncated: false,
    });

    mocks.queryRaw.mockImplementation(async (...args: unknown[]) => {
      const take = sqlLimit(args);
      return Array.from({ length: take }, (_, index) => refRow(index));
    });

    const page = await searchReferences(orgId, 'payments', { limit: 8 });
    expect(sqlLimit(mocks.queryRaw.mock.calls.at(-1) ?? [])).toBe(9);
    expect(Array.isArray(page.references)).toBe(false);
    expect(page.references.items).toHaveLength(8);
    expect(page.references).toMatchObject({ limit: 8, truncated: true });
  });
});
