// Audit log route integration tests. Mirrors the skipIfNoDb pattern from
// opportunities.integration.test.ts so suites stay green offline.
//
// Why integration (not unit-mock): the route's correctness hinges on (a) the
// orgId scoping working through Prisma + the auth plugin, (b) BigInt cursor
// round-tripping through Zod, and (c) the action substring filter actually
// hitting the index. Mocking Prisma would only verify our mock.

import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest';
import { createRequire } from 'node:module';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let primaryOrgId = '';
let foreignOrgId = '';
let restoreAuth: (() => void) | undefined;
const seededIds: bigint[] = [];
const require = createRequire(import.meta.url);

type XlsxModule = {
  read(
    buffer: Buffer,
    opts: { type: 'buffer' },
  ): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json(sheet: unknown, opts: { header: 1 }): unknown[][];
  };
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('audit-logs');
  primaryOrgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  // Create a foreign org so we can prove tenant isolation. We tag it with a
  // throwaway clerkOrg so back-to-back runs cannot collide.
  const foreign = await prisma.org.create({
    data: { clerkOrg: `org_audit_test_foreign_${Date.now()}`, name: 'Audit Test Foreign' },
  });
  foreignOrgId = foreign.id;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (!dbReachable) return;
  // Best-effort cleanup. We only delete rows we ourselves inserted.
  if (seededIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds } } });
  }
  if (foreignOrgId) await prisma.org.delete({ where: { id: foreignOrgId } }).catch(() => undefined);
  if (server) await server.close();
  restoreAuth?.();
  if (primaryOrgId) await dropIsolatedOrg(primaryOrgId);
  await prisma.$disconnect();
});

afterEach(async () => {
  if (!dbReachable || seededIds.length === 0) return;
  await prisma.auditLog.deleteMany({ where: { id: { in: seededIds } } });
  seededIds.length = 0;
});

async function seedAudit(
  orgId: string,
  action: string,
  targetId: string | null = null,
  diff: Record<string, unknown> = { test: true },
) {
  const row = await prisma.auditLog.create({
    data: { orgId, action, targetType: 'opportunity', targetId, diff },
  });
  seededIds.push(row.id);
  return row;
}

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('GET /api/audit-logs', () => {
  skipIfNoDb('isolates rows by orgId — foreign org rows are never returned', async () => {
    // Why: multi-tenancy is the single most-violated invariant in CRM
    // products. If this test ever passes by returning the foreign row, the
    // entire audit feature has to be reconsidered.
    const mine = await seedAudit(primaryOrgId, 'opportunity.test.mine');
    await seedAudit(foreignOrgId, 'opportunity.test.foreign');

    const res = await server.inject({
      method: 'GET',
      url: '/api/audit-logs?action=opportunity.test&limit=50',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mine.id.toString());
    expect(ids.every((id: string) => !id.includes('foreign'))).toBe(true);
    // Verify the foreign row is genuinely absent (not just outside the page)
    const foreignActions = body.items
      .map((i: { action: string }) => i.action)
      .filter((a: string) => a === 'opportunity.test.foreign');
    expect(foreignActions).toHaveLength(0);
  });

  skipIfNoDb('paginates by cursor — second page never repeats first-page rows', async () => {
    // Seed 5 rows with predictable actions so we can assert ordering.
    const seeded = [];
    for (let i = 0; i < 5; i++) {
      seeded.push(await seedAudit(primaryOrgId, `audit.cursor.test.${i}`));
    }

    const page1 = await server.inject({
      method: 'GET',
      url: '/api/audit-logs?action=audit.cursor.test&limit=2',
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.items).toHaveLength(2);
    expect(body1.nextCursor).toBeTruthy();

    const page2 = await server.inject({
      method: 'GET',
      url: `/api/audit-logs?action=audit.cursor.test&limit=2&cursor=${body1.nextCursor}`,
    });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json();
    expect(body2.items).toHaveLength(2);

    const page1Ids = new Set(body1.items.map((i: { id: string }) => i.id));
    for (const item of body2.items) {
      expect(page1Ids.has(item.id)).toBe(false);
    }
    // BigInt cursor must round-trip through the URL as a string without loss.
    expect(seeded.map((r) => r.id.toString())).toContain(body1.nextCursor);
  });

  skipIfNoDb('substring-matches the action filter (case-insensitive)', async () => {
    // Why: UI passes free-text from the search box. If the filter were strict
    // equality, "stage" would never find "opportunity.stage".
    await seedAudit(primaryOrgId, 'opportunity.stage');
    await seedAudit(primaryOrgId, 'opportunity.update');
    await seedAudit(primaryOrgId, 'mcp.tool.call');

    const res = await server.inject({
      method: 'GET',
      url: '/api/audit-logs?action=STAGE&limit=50',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const actions = body.items.map((i: { action: string }) => i.action);
    expect(actions).toContain('opportunity.stage');
    expect(actions).not.toContain('mcp.tool.call');
  });

  skipIfNoDb('exports tenant-scoped XLSX evidence and records the export event', async () => {
    const marker = `audit-export-${Date.now()}`;
    await seedAudit(primaryOrgId, 'audit.export.test.crm', '=HYPERLINK("https://evil.example")', {
      marker,
      changed: { from: 'draft', to: 'approved' },
    });
    await seedAudit(foreignOrgId, 'audit.export.test.foreign', null, { marker });

    const res = await server.inject({
      method: 'GET',
      url: `/api/audit-logs/export.xlsx?q=${encodeURIComponent(marker)}&category=crm&limit=50`,
      headers: { 'user-agent': 'Audit Export Test' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain('bidstack-audit-log-');

    const xlsx = require('@e965/xlsx') as XlsxModule;
    const workbook = xlsx.read(Buffer.from(res.rawPayload), { type: 'buffer' });
    expect(workbook.SheetNames).toContain('Export Metadata');
    expect(workbook.SheetNames).toContain('Audit Log');

    const auditRows = xlsx.utils.sheet_to_json(workbook.Sheets['Audit Log'], { header: 1 });
    expect(auditRows[0]).toEqual([
      'Audit ID',
      'Created At',
      'Actor',
      'Actor Kind',
      'Actor Email',
      'User ID',
      'Action',
      'Category',
      'Risk Score',
      'Target Type',
      'Target ID',
      'Related IDs',
      'Request ID',
      'HTTP Method',
      'HTTP Path',
      'Route',
      'Status Code',
      'Source IP',
      'User Agent',
      'Diff Summary',
      'Diff JSON',
    ]);
    const actions = auditRows.slice(1).map((row) => String(row[6] ?? ''));
    expect(actions).toContain('audit.export.test.crm');
    expect(actions).not.toContain('audit.export.test.foreign');

    const exportedTargetIds = auditRows.slice(1).map((row) => String(row[10] ?? ''));
    expect(exportedTargetIds).toContain('\'=HYPERLINK("https://evil.example")');

    const exportAudit = await prisma.auditLog.findFirst({
      where: {
        orgId: primaryOrgId,
        action: 'audit_log.export.xlsx',
        diff: { path: ['filters', 'q'], equals: marker },
      },
      orderBy: { id: 'desc' },
    });
    expect(exportAudit).toBeTruthy();
    if (exportAudit) {
      seededIds.push(exportAudit.id);
      expect(exportAudit.targetType).toBe('audit_log');
      expect(exportAudit.diff).toMatchObject({
        format: 'xlsx',
        exportedRowCount: 1,
        requestedBy: expect.any(String),
      });
    }
  });

  skipIfNoDb(
    'marks Excel metadata truncated when matching rows exceed export limit inside a batch',
    async () => {
      const marker = `audit-export-truncated-${Date.now()}`;
      await seedAudit(primaryOrgId, 'audit.export.truncated.1', null, {
        marker,
        requestId: 'req-1',
      });
      await seedAudit(primaryOrgId, 'audit.export.truncated.2', null, {
        marker,
        requestId: 'req-2',
      });

      const res = await server.inject({
        method: 'GET',
        url: `/api/audit-logs/export.xlsx?q=${encodeURIComponent(marker)}&limit=1`,
      });

      expect(res.statusCode).toBe(200);

      const xlsx = require('@e965/xlsx') as XlsxModule;
      const workbook = xlsx.read(Buffer.from(res.rawPayload), { type: 'buffer' });
      const metadataRows = xlsx.utils.sheet_to_json(workbook.Sheets['Export Metadata'], {
        header: 1,
      });
      expect(metadataRows).toContainEqual(['Exported rows', 1]);
      expect(metadataRows).toContainEqual(['Truncated by limit', 'yes']);

      const exportAudit = await prisma.auditLog.findFirst({
        where: {
          orgId: primaryOrgId,
          action: 'audit_log.export.xlsx',
          diff: { path: ['filters', 'q'], equals: marker },
        },
        orderBy: { id: 'desc' },
      });
      if (exportAudit) seededIds.push(exportAudit.id);
    },
  );
});
