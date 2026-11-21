// Migration serializers and shared types.
// Used by migrations.ts (core) and migrations-hubspot.routes.ts.

import {
  migrationPublicMessage,
  type MigrationJobResponse,
  type MigrationMappingResponse,
  type MigrationJobError,
} from '@bidstack/shared';

export function serializeJob(row: {
  id: string;
  orgId: string;
  userId: string;
  source: string;
  status: string;
  totalRows: number;
  processedRows: number;
  errorRows: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorSummary: unknown;
  meta: unknown;
  undoableUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MigrationJobResponse {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    source: row.source as MigrationJobResponse['source'],
    status: row.status as MigrationJobResponse['status'],
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    errorRows: row.errorRows,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    errorSummary: publicErrorSummary(row.errorSummary),
    meta: (row.meta as Record<string, unknown>) ?? {},
    undoableUntil: row.undoableUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function publicErrorSummary(value: unknown): MigrationJobError[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const error = (entry ?? {}) as Partial<MigrationJobError>;
    return {
      row: typeof error.row === 'number' ? error.row : 0,
      field: typeof error.field === 'string' ? error.field.slice(0, 100) : null,
      message: migrationPublicMessage(typeof error.message === 'string' ? error.message : ''),
    };
  });
}

export function serializeMapping(row: {
  id: string;
  orgId: string;
  source: string;
  sourceEntity: string;
  mappings: unknown;
  createdAt: Date;
  updatedAt: Date;
}): MigrationMappingResponse {
  return {
    id: row.id,
    orgId: row.orgId,
    source: row.source as MigrationMappingResponse['source'],
    sourceEntity: row.sourceEntity,
    mappings: (row.mappings as Record<string, string | null>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
