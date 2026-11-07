/**
 * Helpers shared by the Chile adapters: amount and date parsing, stage
 * mapping, supplier identity, and record finalization (hashes and keys).
 */

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

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d{1,3}))?$/i;
const THOUSANDS_RE = /^-?\d{1,3}(?:\.\d{3})+$/;

/**
 * Amount to integer micros, or `null` when the value is not a number. Handles
 * comma decimals (`24247,26`), dotted thousands (`1.234.567`), leading zeros,
 * and scientific notation from the bulk export (`9,3e+07`) without passing
 * through floating point. Digits past the sixth decimal are rounded half up.
 */
export function amountMicros(v: unknown): bigint | null {
  let s: string | null;
  const numeric = typeof v === 'number';
  if (numeric) s = Number.isFinite(v) ? String(v) : null;
  else s = str(v);
  if (s === null) return null;
  s = s.replace(/\s/g, '');
  if (!numeric && THOUSANDS_RE.test(s)) s = s.replace(/\./g, '');
  else if (s.includes(',')) {
    if (s.includes('.') || s.indexOf(',') !== s.lastIndexOf(',')) return null;
    s = s.replace(',', '.');
  }
  const m = DECIMAL_RE.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const digits = `${m[2]}${m[3] ?? ''}`.replace(/^0+(?=\d)/, '');
  const scale = Number(m[4] ?? 0) - (m[3] ?? '').length + 6;
  let micros: bigint;
  if (scale >= 0) {
    micros = BigInt(digits) * 10n ** BigInt(scale);
  } else {
    const divisor = 10n ** BigInt(-scale);
    const whole = BigInt(digits);
    micros = whole / divisor + (whole % divisor >= divisor / 2n ? 1n : 0n);
  }
  return m[1] === '-' ? -micros : micros;
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
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;
  return zonedTimeToUtc(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: m[4] ? Number(m[4]) : 0,
      minute: m[5] ? Number(m[5]) : 0,
      second: m[6] ? Number(m[6]) : 0,
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
  'licence',
]);

/** Array fields that are sets: sorted and de-duplicated before hashing. Other arrays keep their order. */
const SET_FIELDS = new Set(['unspscCodes']);

/** Fill `idempotencyKey` and `recordHash` from the record's material fields. */
export function finalizeRecord<T extends PsRecordBase>(draft: Omit<T, 'idempotencyKey' | 'recordHash'>): T {
  const projection: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (NON_MATERIAL_FIELDS.has(k)) continue;
    projection[k] = SET_FIELDS.has(k) && Array.isArray(v) ? [...new Set(v.map(String))].sort() : v;
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

const RUT_IN_TEXT = /\b(\d{1,2}(?:\.\d{3}){2}|\d{7,8})-([\dkK])\b/g;
/** Person fields on the object that directly carries a natural-person RUT. */
const DIRECT_PERSON_KEY =
  /^(nombre(?:proveedor|sucursal|contacto)|nombre de la oferta|razonsocialproveedor|sucursal|descripcionproveedor|direccion|\w*contacto|fono\w*|mail\w*|name|legalName|streetAddress)$/i;
/** Person fields on an ancestor object (an OCDS party whose identifier holds the RUT). */
const PARENT_PERSON_KEY = /^(name|legalName|address|contactPoint)$/i;
const PROCUREMENT_CODE = /^\d+-\d+-[A-Z0-9]{2}\d{2}$/i;
const PERSON_PLACEHOLDER = '[persona natural]';

function isProcurementRow(obj: Record<string, unknown>): boolean {
  return ['CodigoExterno', 'CodigoLicitacion', 'Codigo'].some(
    (k) => typeof obj[k] === 'string' && PROCUREMENT_CODE.test(obj[k]),
  );
}

/**
 * Copy of a raw payload safe to keep next to a normalized record. Every
 * natural-person RUT becomes `rut-hash:<hmac>`; name, address and contact
 * fields next to it (or on the OCDS party above it) become a placeholder, and
 * those names are then removed wherever else they appear in the payload.
 * Company RUTs and public bodies are left as published.
 */
export function redactPersonalRaw(raw: unknown, hashTaxId: (rut: string) => string): unknown {
  const names = new Set<string>();
  const walk = (v: unknown): { value: unknown; direct: boolean; found: boolean } => {
    if (typeof v === 'string') {
      let direct = false;
      const value = v.replace(RUT_IN_TEXT, (match: string) => {
        const rut = parseRut(match);
        if (!rut || rut.body >= NATURAL_PERSON_RUT_CEILING) return match;
        direct = true;
        return `rut-hash:${hashTaxId(rut.formatted)}`;
      });
      return { value, direct, found: direct };
    }
    if (Array.isArray(v)) {
      let found = false;
      const value = v.map((x) => {
        const r = walk(x);
        found ||= r.found;
        return r.value;
      });
      return { value, direct: false, found };
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const obj = v as Record<string, unknown>;
      // OCDS writes the RUT without a dash (`123456785`); only trust that form
      // inside a CL-RUT identifier, where it cannot be an item or UNSPSC code.
      const rutScheme = typeof obj.scheme === 'string' && obj.scheme.toUpperCase() === 'CL-RUT';
      const kids = Object.entries(obj).map(
        ([k, x]) => [k, rutScheme && k === 'id' ? walkRutId(x) : walk(x)] as const,
      );
      const direct = kids.some(([, r]) => r.direct);
      const found = kids.some(([, r]) => r.found);
      const redact = (k: string): boolean => {
        if (direct) return DIRECT_PERSON_KEY.test(k) || (k === 'Nombre' && !isProcurementRow(obj));
        return found && PARENT_PERSON_KEY.test(k);
      };
      const value = Object.fromEntries(
        kids.map(([k, r]) => {
          if (!redact(k) || r.value === null || r.value === '') return [k, r.value];
          if (typeof r.value === 'string' && r.value.trim().length >= 3) names.add(r.value.trim());
          return [k, PERSON_PLACEHOLDER];
        }),
      );
      return { value, direct: false, found };
    }
    return { value: v, direct: false, found: false };
  };
  const walkRutId = (v: unknown): { value: unknown; direct: boolean; found: boolean } => {
    const rut = parseRut(typeof v === 'number' ? String(v) : str(v));
    if (!rut || rut.body >= NATURAL_PERSON_RUT_CEILING) return walk(v);
    return { value: `rut-hash:${hashTaxId(rut.formatted)}`, direct: true, found: true };
  };
  const first = walk(raw).value;
  if (names.size === 0) return first;
  const sweep = (v: unknown): unknown => {
    if (typeof v === 'string') return names.has(v.trim()) ? PERSON_PLACEHOLDER : v;
    if (Array.isArray(v)) return v.map(sweep);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sweep(x)]));
    }
    return v;
  };
  return sweep(first);
}

/**
 * Collects records, drops duplicates by idempotency key (first wins), and
 * passes every `raw` through {@link redactPersonalRaw} so no natural-person
 * RUT or name leaves a normalizer in clear.
 */
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

  constructor(private readonly hashTaxId: (rut: string) => string) {}

  /** Add a record unless one with the same key was already added. */
  add<K extends Exclude<keyof PsNormalized, 'reviewFlags'>>(bucket: K, rec: PsNormalized[K][number]): void {
    if (this.seen.has(rec.idempotencyKey)) return;
    this.seen.add(rec.idempotencyKey);
    rec.raw = redactPersonalRaw(rec.raw, this.hashTaxId);
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
