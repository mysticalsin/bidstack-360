// Audit log read-only routes. Backend writers live across opportunities,
// data verification, and the MCP server; this is the consumer for the UI and
// for compliance exports.
//
// Cursor pagination uses the auto-incrementing BigInt id, exposed as a string
// on the wire so JS Number precision cannot mangle it.

import { createRequire } from 'node:module';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  AuditLogExportFilter,
  AuditLogFilter,
  AuditLogPage,
  type AuditLogEntry,
} from '@bidstack/shared';

const SCAN_MULTIPLIER = 4; // overscan when applying account JSON-path filters
const EXPORT_BATCH_SIZE = 1_000;
const MAX_EXPORT_SCAN_ROWS = 10_000;

const require = createRequire(import.meta.url);

type AuditLogRow = Prisma.AuditLogGetPayload<{
  include: { user: { select: { name: true; email: true } } };
}>;

type AuditExportCategory = AuditLogExportFilter['category'];

type XlsxModule = {
  utils: {
    book_new(): unknown;
    aoa_to_sheet(rows: unknown[][]): unknown;
    book_append_sheet(workbook: unknown, worksheet: unknown, name: string): void;
  };
  write(
    workbook: unknown,
    opts: { type: 'buffer'; bookType: 'xlsx'; compression?: boolean },
  ): Buffer;
};

const CRM_TARGETS = new Set([
  'account',
  'bid_score',
  'company',
  'contact',
  'lead',
  'opportunity',
  'pipeline',
  'quote',
  'invoice',
  'task',
  'territory',
  'service_desk',
  'sales_order',
]);

const SECURITY_TERMS = [
  'api_key',
  'apikey',
  'mcp',
  'webhook',
  'permission',
  'role',
  'auth',
  'login',
  'token',
  'secret',
  'agent',
  'integration',
];
const DESTRUCTIVE_TERMS = ['delete', 'remove', 'revoke', 'cancel', 'disable', 'void', 'archive'];
const SYSTEM_TERMS = ['worker', 'sync', 'import', 'export', 'job', 'queue', 'automation', 'system'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELATED_ID_KEYS = [
  'accountId',
  'companyId',
  'contactId',
  'leadId',
  'opportunityId',
  'proposalId',
  'documentId',
  'invoiceId',
  'taskId',
  'workflowId',
];

export const auditLogsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/audit-logs/export.xlsx',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('audit-log:read'),
      schema: {
        querystring: AuditLogExportFilter,
        response: { 200: z.any() },
      },
    },
    async (req, reply) => {
      const filter = req.query;
      const where = auditLogWhere(req.auth.orgId, filter);
      const collected = await collectExportRows(where, filter);
      const rows = collected.items;
      const exportedAt = new Date();
      const actorUserId = UUID_RE.test(req.auth.userId) ? req.auth.userId : null;
      const fingerprint = clientFingerprint(req);
      const filters = exportFilterSummary(filter);
      const exportDiff: Prisma.InputJsonObject = {
        format: 'xlsx',
        filters,
        exportedRowCount: rows.length,
        scannedRowCount: collected.scanned,
        truncated: collected.truncated,
        requestedBy: req.auth.userId,
        ip: fingerprint.ip,
        userAgent: fingerprint.userAgent,
      };

      const exportAudit = await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: actorUserId,
          action: 'audit_log.export.xlsx',
          targetType: 'audit_log',
          targetId: null,
          diff: exportDiff,
        },
      });

      const workbook = buildAuditWorkbook({
        rows,
        exportedAt,
        exportAuditId: exportAudit.id.toString(),
        orgId: req.auth.orgId,
        requestedBy: req.auth.userId,
        filters,
        scanned: collected.scanned,
        truncated: collected.truncated,
      });
      const stamp = exportedAt.toISOString().slice(0, 10);

      return reply
        .header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(`bidstack-audit-log-${stamp}.xlsx`)}`,
        )
        .header('Cache-Control', 'private, no-store')
        .send(workbook);
    },
  );

  server.get(
    '/audit-logs',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('audit-log:read'),
      schema: {
        querystring: AuditLogFilter,
        response: { 200: AuditLogPage },
      },
    },
    async (req) => {
      const { accountId, cursor, limit } = req.query;
      const where = auditLogWhere(req.auth.orgId, req.query);

      const take = (accountId ? limit * SCAN_MULTIPLIER : limit) + 1;
      const rows = await prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { id: 'desc' },
        take,
        ...(cursor ? { cursor: { id: BigInt(cursor) }, skip: 1 } : {}),
      });

      const trimmed = rows.slice(0, limit);
      const hasMore = rows.length > limit;

      return {
        items: trimmed.map(serializeAuditRow),
        nextCursor: hasMore ? (trimmed[trimmed.length - 1]?.id.toString() ?? null) : null,
      };
    },
  );
};

function auditLogWhere(
  orgId: string,
  filter: Pick<AuditLogFilter, 'accountId' | 'action' | 'targetType' | 'since'>,
): Prisma.AuditLogWhereInput {
  const { accountId, action, targetType, since } = filter;
  return {
    orgId,
    deletedAt: null,
    ...(action ? { action: { contains: action, mode: 'insensitive' } } : {}),
    ...(targetType && targetType !== 'all' ? { targetType } : {}),
    ...(since ? { at: { gte: new Date(since) } } : {}),
    ...(accountId ? { OR: accountIdClauses(accountId) } : {}),
  };
}

// Build the OR clauses for accountId matching. We test:
//   - targetId equals accountId (account-level rows)
//   - diff -> 'accountId' equals accountId (data verification / MCP rows)
//   - diff -> 'opportunityId' equals accountId (defensive legacy writer shape)
function accountIdClauses(accountId: string): Prisma.AuditLogWhereInput[] {
  return [
    { targetId: accountId },
    { diff: { path: ['accountId'], equals: accountId } },
    { diff: { path: ['opportunityId'], equals: accountId } },
  ];
}

async function collectExportRows(
  where: Prisma.AuditLogWhereInput,
  filter: AuditLogExportFilter,
): Promise<{ items: AuditLogEntry[]; scanned: number; truncated: boolean }> {
  const items: AuditLogEntry[] = [];
  let cursor: bigint | undefined;
  let scanned = 0;
  let truncated = false;

  while (items.length < filter.limit && scanned < MAX_EXPORT_SCAN_ROWS) {
    const take = Math.min(EXPORT_BATCH_SIZE, MAX_EXPORT_SCAN_ROWS - scanned);
    const batch = await prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { id: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;

    scanned += batch.length;
    for (let index = 0; index < batch.length; index++) {
      const row = batch[index];
      if (!row) continue;
      const item = serializeAuditRow(row);
      if (!rowMatchesExportCategory(item, filter.category)) continue;
      if (!rowMatchesExportSearch(item, filter.q)) continue;
      items.push(item);
      if (items.length >= filter.limit) {
        if (index < batch.length - 1) truncated = true;
        break;
      }
    }

    cursor = batch[batch.length - 1]?.id;
    if (!cursor || batch.length < take) break;
  }

  if (scanned >= MAX_EXPORT_SCAN_ROWS) {
    truncated = true;
  } else if (items.length >= filter.limit && !truncated) {
    const hasMore = await prisma.auditLog.findFirst({
      where,
      select: { id: true },
      orderBy: { id: 'desc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    truncated = Boolean(hasMore);
  }

  return { items, scanned, truncated };
}

function serializeAuditRow(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id.toString(),
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    userId: row.userId,
    userName: row.user?.name ?? null,
    userEmail: row.user?.email ?? null,
    diff: row.diff ?? null,
    createdAt: row.at.toISOString(),
  };
}

function rowMatchesExportSearch(row: AuditLogEntry, rawQuery: string | undefined): boolean {
  const query = rawQuery?.trim().toLowerCase();
  if (!query) return true;
  return [
    row.id,
    row.createdAt,
    row.action,
    row.targetType,
    row.targetId,
    row.userId,
    row.userName,
    row.userEmail,
    safeJson(row.diff),
  ].some((value) => value?.toLowerCase().includes(query));
}

function rowMatchesExportCategory(row: AuditLogEntry, category: AuditExportCategory): boolean {
  if (category === 'all') return true;
  return classifyAudit(row) === category;
}

function classifyAudit(row: AuditLogEntry): Exclude<AuditExportCategory, 'all'> {
  const haystack = `${row.action} ${row.targetType ?? ''}`.toLowerCase();
  if (DESTRUCTIVE_TERMS.some((term) => haystack.includes(term))) return 'destructive';
  if (SECURITY_TERMS.some((term) => haystack.includes(term))) return 'security';
  if (CRM_TARGETS.has((row.targetType ?? '').toLowerCase())) return 'crm';
  if (SYSTEM_TERMS.some((term) => haystack.includes(term)) || (!row.userId && !row.userEmail)) {
    return 'system';
  }
  return 'crm';
}

function riskScore(row: AuditLogEntry): number {
  const category = classifyAudit(row);
  const categoryScore =
    category === 'destructive'
      ? 82
      : category === 'security'
        ? 68
        : category === 'system'
          ? 42
          : 28;
  const missingEvidencePenalty =
    (hasStructuredDiff(row.diff) ? 0 : 8) +
    (row.targetId ? 0 : 6) +
    (row.userEmail || row.userName || row.userId ? 0 : 4);
  return Math.min(99, categoryScore + missingEvidencePenalty);
}

function hasStructuredDiff(diff: unknown): boolean {
  return Boolean(
    diff &&
      typeof diff === 'object' &&
      !Array.isArray(diff) &&
      Object.keys(diff as Record<string, unknown>).length > 0,
  );
}

function buildAuditWorkbook(args: {
  rows: AuditLogEntry[];
  exportedAt: Date;
  exportAuditId: string;
  orgId: string;
  requestedBy: string;
  filters: Prisma.InputJsonObject;
  scanned: number;
  truncated: boolean;
}): Buffer {
  const xlsx = require('@e965/xlsx') as XlsxModule;
  const workbook = xlsx.utils.book_new();

  const metadataRows = [
    ['Field', 'Value'],
    ['Exported at', args.exportedAt.toISOString()],
    ['Export audit event id', args.exportAuditId],
    ['Organization id', args.orgId],
    ['Requested by', args.requestedBy],
    ['Exported rows', args.rows.length],
    ['Scanned rows', args.scanned],
    ['Truncated by limit', args.truncated ? 'yes' : 'no'],
    ['Filters', safeJson(args.filters)],
    [
      'Notes',
      'Audit exports are tenant-scoped and this export action is written back to the audit log.',
    ],
  ];

  const auditRows = [
    [
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
    ],
    ...args.rows.map((row) => {
      const evidence = extractEvidence(row);
      return [
        safeExcelText(row.id),
        row.createdAt,
        safeExcelText(actorLabel(row)),
        safeExcelText(evidence.actorKind),
        safeExcelText(row.userEmail ?? ''),
        safeExcelText(row.userId ?? ''),
        safeExcelText(row.action),
        classifyAudit(row),
        riskScore(row),
        safeExcelText(row.targetType ?? ''),
        safeExcelText(row.targetId ?? ''),
        safeExcelText(evidence.relatedIds),
        safeExcelText(evidence.requestId),
        safeExcelText(evidence.method),
        safeExcelText(evidence.path),
        safeExcelText(evidence.route),
        evidence.statusCode,
        safeExcelText(evidence.ip),
        safeExcelText(evidence.userAgent),
        safeExcelText(diffSummary(row.diff)),
        safeExcelText(safeJson(row.diff)),
      ];
    }),
  ];

  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(metadataRows), 'Export Metadata');
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(auditRows), 'Audit Log');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function actorLabel(row: AuditLogEntry): string {
  return row.userName || row.userEmail || row.userId || 'System';
}

function extractEvidence(row: AuditLogEntry): {
  actorKind: string;
  relatedIds: string;
  requestId: string;
  method: string;
  path: string;
  route: string;
  statusCode: number | '';
  ip: string;
  userAgent: string;
} {
  const diff = asJsonObject(row.diff);
  const actorKind = stringField(diff, 'actorKind') || (row.userId ? 'user' : 'system');
  return {
    actorKind,
    relatedIds: relatedIds(diff),
    requestId: stringField(diff, 'requestId'),
    method: stringField(diff, 'method'),
    path: stringField(diff, 'path'),
    route: stringField(diff, 'route'),
    statusCode: numberField(diff, 'statusCode'),
    ip: stringField(diff, 'ip'),
    userAgent: stringField(diff, 'userAgent'),
  };
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(source: Record<string, unknown> | null, key: string): string {
  const value = source?.[key];
  return typeof value === 'string' ? value : '';
}

function numberField(source: Record<string, unknown> | null, key: string): number | '' {
  const value = source?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : '';
}

function relatedIds(source: Record<string, unknown> | null): string {
  if (!source) return '';
  return RELATED_ID_KEYS.flatMap((key) => {
    const value = source[key];
    return typeof value === 'string' && value.length > 0 ? [`${key}=${value}`] : [];
  }).join('; ');
}

function diffSummary(diff: unknown): string {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return '';
  return Object.entries(diff as Record<string, unknown>)
    .slice(0, 12)
    .map(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if ('from' in nested || 'to' in nested) {
          return `${key}: ${formatValue(nested.from)} to ${formatValue(nested.to)}`;
        }
        return `${key}: updated`;
      }
      return `${key}: ${formatValue(value)}`;
    })
    .join('; ');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return 'object';
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '';
  }
}

function safeExcelText(value: unknown): string {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function exportFilterSummary(filter: AuditLogExportFilter): Prisma.InputJsonObject {
  return {
    accountId: filter.accountId ?? null,
    action: filter.action ?? null,
    targetType: filter.targetType ?? null,
    since: filter.since ?? null,
    q: filter.q ?? null,
    category: filter.category,
    limit: filter.limit,
  };
}

function clientFingerprint(req: FastifyRequest): { ip: string | null; userAgent: string | null } {
  const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null;
  const ua = req.headers['user-agent'];
  return { ip, userAgent: typeof ua === 'string' && ua.length > 0 ? ua : null };
}
