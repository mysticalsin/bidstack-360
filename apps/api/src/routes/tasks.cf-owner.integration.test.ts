// TaskPatch allows a body that is only customFieldValues. That request 404s
// today: the scalar update is empty, updateMany reports 0 rows, and the
// handler says the task does not exist before it looks at the definitions.
// A definition id from another org must be 400 once that write is reached.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

const headers = { authorization: 'Bearer stub' };

let server: FastifyInstance;
let dbReachable = false;
let orgId: string | null = null;
let otherOrgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let foreignDefinitionId = '';

describe('task custom field patch', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('task-cf');
    const other = await createIsolatedOrg('task-cf-b');
    orgId = org.orgId;
    otherOrgId = other.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    foreignDefinitionId = (
      await prisma.customFieldDefinition.create({
        data: {
          orgId: other.orgId,
          entityType: 'task',
          fieldKey: 'site',
          label: 'Site',
          fieldType: 'text',
        },
        select: { id: true },
      })
    ).id;
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
    if (otherOrgId) await dropIsolatedOrg(otherOrgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  async function createTask(): Promise<string> {
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers,
      payload: { title: 'Custom field ownership', oppId: null, dueDate: null, assignee: null },
    });
    expect(created.statusCode, created.body).toBe(201);
    return (created.json() as { id: string }).id;
  }

  skipIfNoDb('a custom-field-only patch of a foreign definition is 400 and stores nothing', async () => {
    const taskId = await createTask();
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      headers,
      payload: { customFieldValues: [{ definitionId: foreignDefinitionId, value: 'x' }] },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(
      await prisma.customFieldValue.count({ where: { entityId: taskId, definitionId: foreignDefinitionId } }),
    ).toBe(0);
  });

  skipIfNoDb('a custom-field-only patch stores this org definition', async () => {
    const taskId = await createTask();
    const task = await prisma.task.findFirstOrThrow({ where: { id: taskId }, select: { orgId: true } });
    const own = await prisma.customFieldDefinition.create({
      data: {
        orgId: task.orgId,
        entityType: 'task',
        fieldKey: 'site',
        label: 'Site',
        fieldType: 'text',
      },
      select: { id: true },
    });
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      headers,
      payload: { customFieldValues: [{ definitionId: own.id, value: 'north' }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const stored = await prisma.customFieldValue.findFirst({
      where: { entityId: taskId, definitionId: own.id },
      select: { value: true },
    });
    expect(stored?.value).toBe('north');
  });
});
