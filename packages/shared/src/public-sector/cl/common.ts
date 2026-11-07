/**
 * Helpers shared by the Chile adapters: amount and date parsing, stage
 * mapping, supplier identity, and record finalization (hashes and keys).
 */

import { unitsToMicros } from '../../utils/money.js';
import { CHILECOMPRA_ATTRIBUTION } from '../attribution.js';
import { guardedGet, CHILE_SOURCE_HOSTS } from '../fetch-guard.js';
import { psIdempotencyKey, recordHash, sha256Hex } from '../hash.js';
import { CHILE_TIME_ZONE } from '../quota.js';
import { parseRut, NATURAL_PERSON_RUT_CEILING } from '../rut.js';
import { zonedTimeToUtc } from '../time.js';
import type {
  PsFetchContext,
  PsFetchUnit,
  PsNormalizeContext,
  PsNormalized,
  PsRawPage,
  PsRecordBase,
  PsStage,
} from '../types.js';

/** Base for the public ficha pages (human links stored as `sourceUrl`). */
const MP_WEB = 'https://www.mercadopublico.cl';

/** Human link for a tender. */
export function tenderFichaUrl(code: string): string {
  return `${MP_WEB}/fichaLicitacion.html?idLicitacion=${encodeURIComponent(code)}`;
}

/** Human link for a purchase order. */
export function purchaseOrderUrl(code: string): string {
  return `${MP_WEB}/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=${encodeURIComponent(code)}`;
}

/** Buyer unit record as linked from OCDS party identifiers. */
export function buyerUnitUrl(code: string): string {
  return `https://api.mercadopublico.cl/APISOCDS/Comprador/Unidad/${encodeURIComponent(code)}`;
}

/** Chile codes ending in `-TDyy` are Trato Directo (direct award) records. */
export function isTratoDirectoCode(code: string): boolean {
  return /-TD\d{2}$/i.test(code);
}

/** Empty markers used by ChileCompra files. */
export function blank(v: unknown): v is null | undefined | '' {
  return v === null || v === undefined || v === '' || v === 'NA';
}

/** Trimmed string, or `null` for blanks and `NA`. */
export function str(v: unknown): string | null {
  if (blank(v)) return null;
  const s = String(v).trim();
  return s === '' || s === 'NA' ? null : s;
}

/** Integer, or `null`. */
export function int(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Amount to integer micros. Handles comma decimals (`24247,26`), scientific
 * notation from the bulk export (`9,3e+07`) and JSON numbers.
 */
export function amountMicros(v: unknown): bigint | null {
  if (typeof v === 'number') return Number.isFinite(v) ? unitsToMicros(v) : null;
  const s = str(v);
  if (s === null) return null;
  const normalized = s.replace(',', '.');
  if (/^-?\d+(\.\d{1,6})?$/.test(normalized)) return unitsToMicros(normalized);
  const n = Number(normalized);
  return Number.isFinite(n) ? unitsToMicros(n) : null;
}

/**
 * Parse a Chile date. Date-only and zone-less values are Santiago wall time;
 * values with an offset or `Z` are taken as given. `1900-01-01` is a blank.
 */
export function chileDate(v: unknown): Date | null {
  const s = str(v);
  if (s === null || s.startsWith('1900-01-01')) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  return zonedTimeToUtc(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: m[4] ? Number(m[4]) : 0,
      minute: m[5] ? Number(m[5]) : 0,
    },
    CHILE_TIME_ZONE,
  );
}

/** Lowercase, accent-free, single-spaced name for matching. */
export function normalizeEntityName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function labelKey(label: string | null): string {
  return label ? normalizeEntityName(label) : '';
}

/** Tender status codes from the Mercado Publico API docs. */
export const API_TENDER_STATUS_STAGE: Record<number, PsStage> = {
  5: 'active',
  6: 'active',
  7: 'cancelled',
  8: 'awarded',
  18: 'cancelled',
  19: 'active',
};

/**
 * Tender stage. The label wins because codes differ between channels (the
 * bulk file uses 15 for Revocada, the API docs 18); the code table is the
 * fallback for the API.
 */
export function tenderStage(code: number | null, label: string | null): PsStage | null {
  const key = labelKey(label);
  if (key.startsWith('publicada') || key.startsWith('cerrada') || key.startsWith('suspendida')) return 'active';
  if (key.startsWith('adjudicada')) return 'awarded';
  if (key.startsWith('desierta') || key.startsWith('revocada')) return 'cancelled';
  return code !== null ? (API_TENDER_STATUS_STAGE[code] ?? null) : null;
}

/** Purchase order status codes from the API docs. None of them proves payment. */
export const API_PO_STATUS_STAGE: Record<number, PsStage> = {
  4: 'ordered',
  5: 'ordered',
  6: 'ordered',
  9: 'cancelled',
  12: 'ordered',
  13: 'ordered',
  14: 'ordered',
  15: 'ordered',
};

/** Purchase order stage. Reception is not payment, so nothing maps to `paid`. */
export function purchaseOrderStage(code: number | null, label: string | null): PsStage | null {
  const key = labelKey(label);
  if (key.startsWith('cancelada') || key.startsWith('eliminada')) return 'cancelled';
  if (
    /^(enviada|en proceso|aceptada|recepcion|pendiente|recepcionada)/.test(key)
  ) {
    return 'ordered';
  }
  return code !== null ? (API_PO_STATUS_STAGE[code] ?? null) : null;
}

/** Fields that are provenance, not business facts: excluded from `recordHash`. */
const NON_MATERIAL_FIELDS = new Set([
  'raw',
  'retrievedAt',
  'sourceUpdatedAt',
  'rawPayloadHash',
  'recordHash',
  'apiUrl',
  'confidenceBps',
  'idempotencyKey',
  'attribution',
]);

/** Fill `idempotencyKey` and `recordHash` from the record's material fields. */
export function finalizeRecord<T extends PsRecordBase>(draft: Omit<T, 'idempotencyKey' | 'recordHash'>): T {
  const projection: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (NON_MATERIAL_FIELDS.has(k)) continue;
    projection[k] = Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...new Set(v)].sort() : v;
  }
  return {
    ...draft,
    idempotencyKey: psIdempotencyKey(draft.sourceKey, draft.kind, draft.externalId),
    recordHash: recordHash(projection),
  } as T;
}

/** Common provenance for every record built from one raw page. */
export interface ChileProvenance {
  sourceKey: string;
  apiUrl: string;
  retrievedAt: Date;
  rawPayloadHash: string;
  licence: string;
  attribution: string;
}

/** Provenance block for records built from a fetched page. */
export function provenanceFromRaw(raw: PsRawPage, licence: string): ChileProvenance {
  return {
    sourceKey: raw.unit.sourceKey,
    apiUrl: raw.requestUrlRedacted,
    retrievedAt: raw.retrievedAt,
    rawPayloadHash: raw.rawPayloadHash,
    licence,
    attribution: CHILECOMPRA_ATTRIBUTION,
  };
}

/** Supplier identity derived from a RUT. Natural persons get a keyed hash, not the RUT. */
export function supplierIdentity(
  rawRut: unknown,
  ctx: PsNormalizeContext,
): { externalId: string; taxId: string | null; taxIdHash: string | null; isNaturalPerson: boolean } | null {
  const rut = parseRut(str(rawRut));
  if (!rut) return null;
  if (rut.body < NATURAL_PERSON_RUT_CEILING) {
    const taxIdHash = ctx.hashTaxId(rut.formatted);
    return { externalId: `rut-hash:${taxIdHash}`, taxId: null, taxIdHash, isNaturalPerson: true };
  }
  return { externalId: `rut:${rut.formatted}`, taxId: rut.formatted, taxIdHash: null, isNaturalPerson: false };
}

/** Collects records and drops duplicates by idempotency key (first wins). */
export class NormalizedCollector {
  private readonly seen = new Set<string>();
  readonly out: PsNormalized = {
    entities: [],
    opportunities: [],
    suppliers: [],
    offers: [],
    purchaseOrders: [],
    reviewFlags: [],
  };

  /** Add a record unless one with the same key was already added. */
  add<K extends Exclude<keyof PsNormalized, 'reviewFlags'>>(bucket: K, rec: PsNormalized[K][number]): void {
    if (this.seen.has(rec.idempotencyKey)) return;
    this.seen.add(rec.idempotencyKey);
    (this.out[bucket] as PsRecordBase[]).push(rec);
  }

  /** Add a review flag once per kind and target. */
  flag(f: PsNormalized['reviewFlags'][number]): void {
    const key = `flag:${f.kind}:${f.targetKind}:${f.targetExternalId}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.out.reviewFlags.push(f);
  }
}

/**
 * Fetch one unit through the guard and package it as a raw page. `secret`
 * is appended as the `ticket` parameter only on the outgoing request.
 */
export async function fetchChileRawPage(
  unit: PsFetchUnit,
  ctx: PsFetchContext,
  opts: { ticket?: string } = {},
): Promise<PsRawPage> {
  const url = new URL(unit.url);
  if (opts.ticket) url.searchParams.set('ticket', opts.ticket);
  const res = await guardedGet(ctx.fetch, url.toString(), { allowedHosts: CHILE_SOURCE_HOSTS, now: ctx.now });
  return {
    unit,
    httpStatus: res.httpStatus,
    requestUrlRedacted: res.requestUrlRedacted,
    retrievedAt: ctx.now?.() ?? new Date(),
    contentType: res.contentType,
    rawPayloadHash: sha256Hex(res.body),
    bytes: res.body.byteLength,
    body: new TextDecoder('utf-8').decode(res.body),
  };
}
