import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.fn();

vi.mock('@bidstack/db', () => ({
  prisma: {
    opportunity: { findFirst },
  },
}));

const { opportunitiesGet } = await import('./opportunities-get.js');

const ctx = { orgId: 'org-1', keyId: 'key-1', scopes: ['read'] } as never;

function deal(
  tasks: Array<{ id: string; title: string; createdAt: Date }>,
  documents: Array<{ id: string; name: string; kind: string }> = [],
) {
  return {
    id: 'opp-1',
    code: 'OP-2041',
    customer: 'Stored label',
    companyId: 'company-1',
    name: 'Linked get',
    stage: 's1_lead',
    pipelineStage: null,
    valueMicros: 0n,
    probability: 0,
    dueDate: null,
    owner: null,
    industry: null,
    intel: {},
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    tasks: tasks.map((task) => ({
      ...task,
      status: 'open',
      dueDate: null,
    })),
    documents,
  };
}

beforeEach(() => {
  findFirst.mockReset();
});

describe('opportunities.get tasks', () => {
  it('does not return one follow-up as a bare array, or a short page as the whole list', async () => {
    // WHY: tasks were a bare array of the first 50. Dust could treat that page
    // as every follow-up. One task is the whole list. A 51st row sets truncated.
    findFirst.mockImplementation(async () =>
      deal([
        {
          id: 'task-0',
          title: 'Only follow-up',
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ]),
    );

    const one = (await opportunitiesGet.handler({ id: 'opp-1' }, ctx)) as {
      tasks: {
        items: Array<{ title: string; status: string; dueDate: string | null }>;
        limit: number;
        truncated: boolean;
      };
    };
    expect(Array.isArray(one.tasks)).toBe(false);
    expect(one.tasks).toEqual({
      items: [{ id: 'task-0', title: 'Only follow-up', status: 'open', dueDate: null }],
      limit: 50,
      truncated: false,
    });

    findFirst.mockImplementation(async (args: { include: { tasks: { take: number } } }) => {
      const take = args.include.tasks.take;
      return deal(
        Array.from({ length: Math.min(51, take) }, (_, index) => ({
          id: `task-${index}`,
          title: `Follow-up ${index}`,
          createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, index)),
        })),
      );
    });

    const page = (await opportunitiesGet.handler({ id: 'opp-1' }, ctx)) as {
      tasks: { items: unknown[]; limit: number; truncated: boolean };
    };
    const queriedTake = findFirst.mock.calls.at(-1)?.[0] as {
      include: { tasks: { take: number } };
    };
    expect(queriedTake.include.tasks.take).toBe(51);
    expect(Array.isArray(page.tasks)).toBe(false);
    expect(page.tasks.items).toHaveLength(50);
    expect(page.tasks).toMatchObject({ limit: 50, truncated: true });
  });
});

describe('opportunities.get documents', () => {
  it('does not return one file as a bare array, or a short page as the whole set', async () => {
    // WHY: documents were a bare array of the first 50. Dust could treat that
    // page as every file. One document is the whole set. A 51st row sets truncated.
    findFirst.mockImplementation(async () =>
      deal([], [{ id: 'doc-0', name: 'Only file', kind: 'brief' }]),
    );

    const one = (await opportunitiesGet.handler({ id: 'opp-1' }, ctx)) as {
      documents: {
        items: Array<{ id: string; name: string; kind: string }>;
        limit: number;
        truncated: boolean;
      };
    };
    expect(Array.isArray(one.documents)).toBe(false);
    expect(one.documents).toEqual({
      items: [{ id: 'doc-0', name: 'Only file', kind: 'brief' }],
      limit: 50,
      truncated: false,
    });

    findFirst.mockImplementation(async (args: { include: { documents: { take: number } } }) => {
      const take = args.include.documents.take;
      return deal(
        [],
        Array.from({ length: Math.min(51, take) }, (_, index) => ({
          id: `doc-${index}`,
          name: `File ${index}`,
          kind: 'brief',
        })),
      );
    });

    const page = (await opportunitiesGet.handler({ id: 'opp-1' }, ctx)) as {
      documents: { items: unknown[]; limit: number; truncated: boolean };
    };
    const queriedTake = findFirst.mock.calls.at(-1)?.[0] as {
      include: { documents: { take: number } };
    };
    expect(queriedTake.include.documents.take).toBe(51);
    expect(Array.isArray(page.documents)).toBe(false);
    expect(page.documents.items).toHaveLength(50);
    expect(page.documents).toMatchObject({ limit: 50, truncated: true });
  });
});
