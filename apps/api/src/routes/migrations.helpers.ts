// Migration serializers and shared types.
// Used by migrations.ts (core) and migrations-hubspot.routes.ts.

import {
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
    errorSummary: (row.errorSummary as MigrationJobError[]) ?? [],
    meta: (row.meta as Record<string, unknown>) ?? {},
    undoableUntil: row.undoableUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
