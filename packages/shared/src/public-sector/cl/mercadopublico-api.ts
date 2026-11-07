/**
 * Chile: Mercado Publico REST API adapter (ticketed), source key `cl.mp.api`.
 *
 * Docs and terms: https://www.chilecompra.cl/api/
 * Base: https://api.mercadopublico.cl/servicios/v1/publico/
 * Learned from: open-contracting/kingfisher-collect (BSD-3-Clause),
 * `kingfisher_scrapy/spiders/chile_compra_api_base.py`.
 *
 * - One ticket per person, 10,000 requests per day. The ticket value is read
 *   by NAME (`MERCADOPUBLICO_API_TICKET`), sent only on the outgoing request,
 *   and redacted everywhere else.
 * - A bad ticket answers HTTP 203 with `{"Codigo":203,...}`, not 401. That is
 *   an auth error: never retried, and the source pauses.
 * - No pagination: queries are scoped by day, code, buyer or supplier.
 */

import { z } from 'zod';

import { CHILE_LICENCES, CHILECOMPRA_ATTRIBUTION } from '../attribution.js';
import { computeConfidenceBps, SOURCE_TIER } from '../confidence.js';
import { PsSourceError } from '../errors.js';
import { BULK_QUIET_HOURS, CHILE_TIME_ZONE, MERCADOPUBLICO_DAILY_LIMIT, DEFAULT_QUOTA_SAFETY_MARGIN } from '../quota.js';
import { createReviewFlag } from '../review-flags.js';
import { zonedParts } from '../time.js';
import type {
  PsAdapter,
  PsFetchUnit,
  PsNormalizeContext,
  PsNormalized,
  PsOffer,
  PsOpportunity,
  PsPublicEntity,
  PsPurchaseOrder,
  PsRawPage,
  PsSupplier,
} from '../types.js';
import {
  amountMicros,
  chileDate,
  fetchChileRawPage,
  finalizeRecord,
  isTratoDirectoCode,
  normalizeEntityName,
  NormalizedCollector,
  provenanceFromRaw,
  purchaseOrderStage,
  buyerUnitUrl,
  purchaseOrderUrl,
  str,
  supplierIdentity,
  tenderFichaUrl,
  tenderStage,
  type ChileProvenance,
} from './common.js';

/** Credential NAME for the ticket. The value never appears in code or logs. */
export const MERCADOPUBLICO_TICKET_ENV = 'MERCADOPUBLICO_API_TICKET';

const API_BASE = 'https://api.mercadopublico.cl/servicios/v1/publico';
const SOURCE_KEY = 'cl.mp.api';

/** Read the ticket from an env-like object by name. Blank counts as missing. */
export function readTicketFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  const value = env[MERCADOPUBLICO_TICKET_ENV];
  return value && value.trim() !== '' ? value.trim() : null;
}

const ErrorBody = z.object({ Codigo: z.number(), Mensaje: z.string().optional() });

const Comprador = z
  .object({
    CodigoOrganismo: z.union([z.string(), z.number()]).nullish(),
    NombreOrganismo: z.string().nullish(),
    RutUnidad: z.string().nullish(),
    CodigoUnidad: z.union([z.string(), z.number()]).nullish(),
    NombreUnidad: z.string().nullish(),
    ComunaUnidad: z.string().nullish(),
    RegionUnidad: z.string().nullish(),
  })
  .passthrough();

const Licitacion = z
  .object({
    CodigoExterno: z.string(),
    Nombre: z.string(),
    CodigoEstado: z.number(),
    Estado: z.string().nullish(),
    Descripcion: z.string().nullish(),
    FechaCierre: z.string().nullish(),
    Tipo: z.string().nullish(),
    Moneda: z.string().nullish(),
    MontoEstimado: z.number().nullish(),
    Comprador: Comprador.nullish(),
    Fechas: z
      .object({
        FechaPublicacion: z.string().nullish(),
        FechaCierre: z.string().nullish(),
        FechaAdjudicacion: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    Items: z
      .object({
        Listado: z.array(
          z
            .object({
              Correlativo: z.number(),
              CodigoProducto: z.union([z.number(), z.string()]).nullish(),
              Cantidad: z.number().nullish(),
              Adjudicacion: z
                .object({
                  RutProveedor: z.string(),
                  NombreProveedor: z.string().nullish(),
                  Cantidad: z.number().nullish(),
                  MontoUnitario: z.number().nullish(),
                })
                .passthrough()
                .nullish(),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .nullish(),
    Adjudicacion: z
      .object({ Fecha: z.string().nullish(), NumeroOferentes: z.number().nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const OrdenCompra = z
  .object({
    Codigo: z.string(),
    Nombre: z.string().nullish(),
    CodigoEstado: z.number(),
    Estado: z.string().nullish(),
    CodigoLicitacion: z.string().nullish(),
    Tipo: z.string().nullish(),
    TipoMoneda: z.string().nullish(),
    Total: z.number().nullish(),
    Fechas: z
      .object({
        FechaCreacion: z.string().nullish(),
        FechaEnvio: z.string().nullish(),
        FechaUltimaModificacion: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    Comprador: Comprador.nullish(),
    Proveedor: z
      .object({
        Codigo: z.union([z.string(), z.number()]).nullish(),
        Nombre: z.string().nullish(),
        RutSucursal: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const ListBody = z
  .object({ Cantidad: z.number().optional(), FechaCreacion: z.string().optional(), Listado: z.array(z.unknown()) })
  .passthrough();

/**
 * Validate a Mercado Publico body. Throws `PsSourceError('auth')` for
 * `{"Codigo":203}` (invalid ticket) and `schema` for anything unexpected.
 */
export function parseMercadoPublicoBody(json: unknown, httpStatus = 200): z.infer<typeof ListBody> {
  const err = ErrorBody.safeParse(json);
  if (err.success && !(json as Record<string, unknown>).Listado) {
    if (err.data.Codigo === 203) {
      throw new PsSourceError('auth', 'Mercado Publico rejected the ticket (Codigo 203)', {
        doNotRetry: true,
        httpStatus,
      });
    }
    throw new PsSourceError('http', `Mercado Publico error Codigo ${err.data.Codigo}`, { httpStatus });
  }
  const list = ListBody.safeParse(json);
  if (!list.success) {
    throw new PsSourceError('schema', 'Unexpected Mercado Publico response shape', { doNotRetry: true, httpStatus });
  }
  return list.data;
}

function ddmmyyyy(date: Date): string {
  const p = zonedParts(date, CHILE_TIME_ZONE);
  return `${String(p.day).padStart(2, '0')}${String(p.month).padStart(2, '0')}${p.year}`;
}

function* chileDays(from: Date, to: Date): Generator<Date> {
  const start = zonedParts(from, CHILE_TIME_ZONE);
  const end = zonedParts(to, CHILE_TIME_ZONE);
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day, 12));
  const last = Date.UTC(end.year, end.month - 1, end.day, 12);
  for (let guard = 0; cursor.getTime() <= last && guard < 366; guard += 1) {
    // Noon UTC on a Chile date is the same Chile date in either offset.
    yield new Date(cursor.getTime() + 4 * 3600_000);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

function entityFrom(c: z.infer<typeof Comprador>, prov: ChileProvenance): PsPublicEntity | null {
  const code = str(c.CodigoUnidad);
  if (!code) return null;
  const name = str(c.NombreUnidad) ?? str(c.NombreOrganismo) ?? code;
  const taxId = str(c.RutUnidad);
  return finalizeRecord<PsPublicEntity>({
    kind: 'public_entity',
    country: 'CL',
    ...prov,
    externalId: code,
    sourceUrl: buyerUnitUrl(code),
    publishedAt: null,
    sourceUpdatedAt: null,
    taxId,
    name,
    normalizedName: normalizeEntityName(name),
    organismCode: str(c.CodigoOrganismo),
    organismName: str(c.NombreOrganismo),
    sector: null,
    region: str(c.RegionUnidad),
    comuna: str(c.ComunaUnidad),
    confidenceBps: computeConfidenceBps({ tier: SOURCE_TIER.officialApi, required: [taxId, name] }),
    raw: { CodigoUnidad: c.CodigoUnidad, NombreUnidad: c.NombreUnidad, RutUnidad: c.RutUnidad },
  });
}

function normalizeLicitaciones(list: unknown[], prov: ChileProvenance, ctx: PsNormalizeContext): PsNormalized {
  const col = new NormalizedCollector(ctx.hashTaxId);
  for (const item of list) {
    const parsed = Licitacion.safeParse(item);
    if (!parsed.success) continue;
    const l = parsed.data;
    const code = l.CodigoExterno.trim();
    const entity = l.Comprador ? entityFrom(l.Comprador, prov) : null;
    if (entity) col.add('entities', entity);
    const stage = tenderStage(l.CodigoEstado, str(l.Estado));
    const bidderCount = l.Adjudicacion?.NumeroOferentes ?? null;
    const items = l.Items?.Listado ?? [];
    const unspsc = items.map((i) => str(i.CodigoProducto)).filter((x): x is string => x !== null);
    const publishedAt = chileDate(l.Fechas?.FechaPublicacion);
    const closesAt = chileDate(l.Fechas?.FechaCierre ?? l.FechaCierre);
    const opp = finalizeRecord<PsOpportunity>({
      kind: 'opportunity',
      country: 'CL',
      ...prov,
      externalId: code,
      sourceUrl: tenderFichaUrl(code),
      publishedAt,
      sourceUpdatedAt: null,
      ocid: `ocds-70d2nz-${code}`,
      title: l.Nombre.trim(),
      description: str(l.Descripcion),
      buyerExternalId: entity?.externalId ?? null,
      stage,
      statusCode: l.CodigoEstado,
      statusLabel: str(l.Estado),
      procurementMethod: tenderMethodFromType(str(l.Tipo)),
      procurementMethodDetails: str(l.Tipo),
      isDirectAward: false,
      closesAt,
      awardedAt: chileDate(l.Fechas?.FechaAdjudicacion ?? l.Adjudicacion?.Fecha),
      estimatedValueMicros: amountMicros(l.MontoEstimado),
      currencyCode: str(l.Moneda),
      unspscCodes: [...new Set(unspsc)].sort(),
      region: str(l.Comprador?.RegionUnidad),
      bidderCount,
      confidenceBps: computeConfidenceBps({
        tier: SOURCE_TIER.officialApi,
        required: [l.Nombre, entity, stage, closesAt],
      }),
      raw: item,
    });
    col.add('opportunities', opp);
    if (bidderCount === 1) {
      col.flag(createReviewFlag('single_bidder', { kind: 'opportunity', externalId: code, sourceKey: SOURCE_KEY }));
    }
    for (const line of items) {
      const adj = line.Adjudicacion;
      const who = adj ? supplierIdentity(adj.RutProveedor, ctx) : null;
      if (!adj || !who) continue;
      const name = str(adj.NombreProveedor) ?? who.externalId;
      col.add(
        'suppliers',
        finalizeRecord<PsSupplier>({
          kind: 'supplier',
          country: 'CL',
          ...prov,
          sourceUrl: tenderFichaUrl(code),
          publishedAt: null,
          sourceUpdatedAt: null,
          ...who,
          name,
          normalizedName: normalizeEntityName(name),
          sourceSupplierCode: null,
          confidenceBps: computeConfidenceBps({ tier: SOURCE_TIER.officialApi, required: [name] }),
          raw: who.isNaturalPerson ? { naturalPerson: true } : adj,
        }),
      );
      const qty = adj.Cantidad ?? null;
      const unit = adj.MontoUnitario ?? null;
      col.add(
        'offers',
        finalizeRecord<PsOffer>({
          kind: 'offer',
          country: 'CL',
          ...prov,
          externalId: `${code}:${line.Correlativo}:${who.externalId}`,
          sourceUrl: tenderFichaUrl(code),
          publishedAt: null,
          sourceUpdatedAt: null,
          opportunityExternalId: code,
          supplierExternalId: who.externalId,
          lineId: String(line.Correlativo),
          unspsc: str(line.CodigoProducto),
          offeredAmountMicros: null,
          awardedAmountMicros: qty !== null && unit !== null ? amountMicros(qty * unit) : null,
          awardedQuantity: qty,
          currencyCode: str(l.Moneda),
          selected: true,
          offerStatus: 'Adjudicada',
          submittedAt: null,
          confidenceBps: computeConfidenceBps({ tier: SOURCE_TIER.officialApi, required: [qty, unit] }),
          raw: line,
        }),
      );
    }
  }
  return col.out;
}

function normalizeOrdenes(list: unknown[], prov: ChileProvenance, ctx: PsNormalizeContext): PsNormalized {
  const col = new NormalizedCollector(ctx.hashTaxId);
  for (const item of list) {
    const parsed = OrdenCompra.safeParse(item);
    if (!parsed.success) continue;
    const o = parsed.data;
    const code = o.Codigo.trim();
    const entity = o.Comprador ? entityFrom(o.Comprador, prov) : null;
    if (entity) col.add('entities', entity);
    const who = supplierIdentity(o.Proveedor?.RutSucursal, ctx);
    if (who) {
      const name = str(o.Proveedor?.Nombre) ?? who.externalId;
      col.add(
        'suppliers',
        finalizeRecord<PsSupplier>({
          kind: 'supplier',
          country: 'CL',
          ...prov,
          sourceUrl: purchaseOrderUrl(code),
          publishedAt: null,
          sourceUpdatedAt: null,
          ...who,
          name,
          normalizedName: normalizeEntityName(name),
          sourceSupplierCode: str(o.Proveedor?.Codigo),
          confidenceBps: computeConfidenceBps({ tier: SOURCE_TIER.officialApi, required: [name] }),
          raw: who.isNaturalPerson ? { naturalPerson: true } : o.Proveedor,
        }),
      );
    }
    const isDirectAward = (str(o.Tipo) ?? '').toUpperCase() === 'TD' || isTratoDirectoCode(code);
    const stage = purchaseOrderStage(o.CodigoEstado, str(o.Estado));
    const amount = amountMicros(o.Total);
    col.add(
      'purchaseOrders',
      finalizeRecord<PsPurchaseOrder>({
        kind: 'purchase_order',
        country: 'CL',
        ...prov,
        externalId: code,
        sourceUrl: purchaseOrderUrl(code),
        publishedAt: chileDate(o.Fechas?.FechaCreacion),
        sourceUpdatedAt: chileDate(o.Fechas?.FechaUltimaModificacion),
        title: str(o.Nombre),
        buyerExternalId: entity?.externalId ?? null,
        supplierExternalId: who?.externalId ?? null,
        opportunityExternalId: str(o.CodigoLicitacion),
        stage,
        statusCode: o.CodigoEstado,
        statusLabel: str(o.Estado),
        amountMicros: amount,
        currencyCode: str(o.TipoMoneda),
        issuedAt: chileDate(o.Fechas?.FechaEnvio),
        isDirectAward,
        excludedFromOfficial: false,
        exclusionReason: null,
        confidenceBps: computeConfidenceBps({ tier: SOURCE_TIER.officialApi, required: [amount, entity, who, stage] }),
        raw: item,
      }),
    );
    if (isDirectAward) {
      col.flag(createReviewFlag('direct_award', { kind: 'purchase_order', externalId: code, sourceKey: SOURCE_KEY }));
    }
  }
  return col.out;
}

/**
 * Procurement method from the tender type code (`L1`, `LE`, `LP`, `LQ`, `LR`
 * and `LS` are public calls; `E2`, `CO`, `B2`, `H2`, `I2` are private calls,
 * per the API docs). Unknown types stay `null` rather than guessing.
 */
function tenderMethodFromType(tipo: string | null): PsOpportunity['procurementMethod'] {
  if (!tipo) return null;
  const t = tipo.toUpperCase();
  if (['L1', 'LE', 'LP', 'LQ', 'LR', 'LS'].includes(t)) return 'open';
  if (['E2', 'CO', 'B2', 'H2', 'I2'].includes(t)) return 'selective';
  return null;
}

/** The Mercado Publico API adapter. */
export const mercadoPublicoAdapter: PsAdapter<null> = {
  country: 'CL',
  sourceKey: SOURCE_KEY,
  credentialName: MERCADOPUBLICO_TICKET_ENV,
  licence: CHILE_LICENCES.api,
  attribution: CHILECOMPRA_ATTRIBUTION,
  budget: {
    perDay: Math.floor(MERCADOPUBLICO_DAILY_LIMIT * (1 - DEFAULT_QUOTA_SAFETY_MARGIN)),
    quietHoursLocal: BULK_QUIET_HOURS,
    timeZone: CHILE_TIME_ZONE,
  },

  plan(window) {
    const units: PsFetchUnit[] = [];
    for (const day of chileDays(window.from, window.to)) {
      const fecha = ddmmyyyy(day);
      units.push(
        { sourceKey: SOURCE_KEY, kind: 'mp.licitaciones', url: `${API_BASE}/licitaciones.json?fecha=${fecha}` },
        {
          sourceKey: SOURCE_KEY,
          kind: 'mp.ordenesdecompra',
          url: `${API_BASE}/ordenesdecompra.json?fecha=${fecha}&estado=todos`,
        },
      );
    }
    return units;
  },

  async fetch(unit, ctx) {
    if (!ctx.secret) {
      throw new PsSourceError('auth', `No ticket configured (${MERCADOPUBLICO_TICKET_ENV})`, { doNotRetry: true });
    }
    if (!ctx.quota) {
      throw new PsSourceError('quota_exhausted', 'A quota guard is required for the ticketed API', { doNotRetry: true });
    }
    await ctx.quota.reserve();
    const raw = await fetchChileRawPage(unit, ctx, { ticket: ctx.secret });
    if (raw.httpStatus === 203) {
      throw new PsSourceError('auth', 'Mercado Publico rejected the ticket (HTTP 203)', {
        doNotRetry: true,
        httpStatus: 203,
      });
    }
    let json: unknown;
    try {
      json = JSON.parse(raw.body);
    } catch {
      throw new PsSourceError('schema', 'Mercado Publico returned non-JSON', { doNotRetry: true });
    }
    parseMercadoPublicoBody(json, raw.httpStatus);
    return raw;
  },

  normalize(raw: PsRawPage, ctx) {
    const body = parseMercadoPublicoBody(JSON.parse(raw.body), raw.httpStatus);
    const prov = provenanceFromRaw(raw, CHILE_LICENCES.api);
    return raw.unit.kind === 'mp.ordenesdecompra'
      ? normalizeOrdenes(body.Listado, prov, ctx)
      : normalizeLicitaciones(body.Listado, prov, ctx);
  },

  nextCursor() {
    return null;
  },
};
