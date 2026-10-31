// MSA library contract, re-exported from @bidstack/shared (packages/shared/src/schemas/msa.ts)
// so the web and the API cannot drift. Query and create bodies use the zod *input*
// types: the server fills the defaults (limit, sort, topLevel, status, tags).
import {
  MsaKind as MsaKindSchema,
  MsaStatus as MsaStatusSchema,
  type MsaCreate as MsaCreateSchema,
  type MsaListQuery as MsaListQuerySchema,
} from '@bidstack/shared';
import type { z } from 'zod';

export {
  MSA_ALLOWED_CONTENT_TYPES,
  MSA_CHILD_KINDS,
  MSA_MAX_BYTES,
} from '@bidstack/shared';
export type {
  MsaAccountSummary,
  MsaContentType,
  MsaDetail,
  MsaDownloadUrlResponse,
  MsaFileVersion,
  MsaKind,
  MsaLiabilityCap,
  MsaListResponse,
  MsaSearchHit,
  MsaSearchResponse,
  MsaStatus,
  MsaSummaryRow,
  MsaTimelineEvent,
  MsaTimelineResponse,
  MsaUploadUrlRequest,
  MsaUploadUrlResponse,
  MsaUserRef,
  MsaVersionFinalize,
} from '@bidstack/shared';

export const MSA_KINDS = MsaKindSchema.options;
export const MSA_STATUSES = MsaStatusSchema.options;

export type MsaListQuery = z.input<typeof MsaListQuerySchema>;
export type MsaCreate = z.input<typeof MsaCreateSchema>;
