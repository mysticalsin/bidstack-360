/**
 * Chile: Datos Abiertos bulk files (no auth), source keys `cl.da.lic` and
 * `cl.da.oc`.
 *
 * Page: https://datos-abiertos.chilecompra.cl/descargas
 * Files: https://transparenciachc.blob.core.windows.net/{lic-da,oc-da}/{YYYY}-{M}.zip
 * Erroneous POs: .../oc-da/hist_OC_erroneas.csv (`idoc; numoc; NroLicitacion`)
 *
 * Latin-1, `;` delimited, quoted fields with embedded `;` and newlines.
 * `lic-da` has one row per line item per offer received. `oc-da` has one row
 * per purchase order line. POs on the erroneous list are kept and flagged
 * `excludedFromOfficial`, never dropped. These loaders take the CSV member's
 * bytes as a stream and parse incrementally, but they hold one month of
 * normalized records in memory; batching, unzipping and storage are the
 * worker's job.
 */

import { createHash } from 'node:crypto';

import { CHILE_LICENCES, CHILECOMPRA_ATTRIBUTION } from '../attribution.js';
import { computeConfidenceBps, SOURCE_TIER } from '../confidence.js';
import { decodeLatin1, iterateCsvRecords, normalizeCsvHeader, parseCsvText } from '../csv.js';
import { PsSourceError } from '../errors.js';
import { BULK_MAX_RESPONSE_BYTES } from '../fetch-guard.js';
import { sha256Hex } from '../hash.js';
import { assertBulkWindow } from '../quota.js';
import { createReviewFlag } from '../review-flags.js';
import type {
  PsFetchContext,
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
  buyerUnitUrl,
  chileDate,
  fetchChileRawPage,
  finalizeRecord,
  int,
  normalizeEntityName,
  NormalizedCollector,
  purchaseOrderStage,
  purchaseOrderUrl,
  str,
  supplierIdentity,
  tenderFichaUrl,
  tenderStage,
  type ChileProvenance,
} from './common.js';

const BLOB_BASE = 'https://transparenciachc.blob.core.windows.net';

/** Bulk file kinds. */
export type ChileBulkKind = 'lic' | 'oc' | 'erroneous-po';

/** Official URL of a bulk file. */
export function bulkFileUrl(kind: ChileBulkKind, year?: number, month?: number): string {
  if (kind === 'erroneous-po') return `${BLOB_BASE}/oc-da/hist_OC_erroneas.csv`;
  if (!year || !month) throw new Error('year and month are required for monthly bulk files');
  return `${BLOB_BASE}/${kind}-da/${year}-${month}.zip`;
}

/** Plan one month of bulk work. Refuses outside 22:00 to 07:00 America/Santiago. */
export function planBulkMonth(opts: { year: number; month: number; now?: Date }): PsFetchUnit[] {
  assertBulkWindow(opts.now ?? new Date());
  return [
    { sourceKey: 'cl.da.lic', kind: 'bulk.lic', url: bulkFileUrl('lic', opts.year, opts.month) },
    { sourceKey: 'cl.da.oc', kind: 'bulk.oc', url: bulkFileUrl('oc', opts.year, opts.month) },
    { sourceKey: 'cl.da.oc', kind: 'bulk.erroneous-po', url: bulkFileUrl('erroneous-po') },
  ];
}

/**
 * Download one bulk unit (the erroneous PO list, or a monthly archive for the
 * worker to unzip). Refuses outside the quiet window, so a caller cannot load
 * ChileCompra's blob store during office hours. The parsers below work on
 * bytes already fetched and do not touch the network.
 */
export async function fetchBulkUnit(unit: PsFetchUnit, ctx: PsFetchContext): Promise<PsRawPage> {
  assertBulkWindow(ctx.now?.() ?? new Date());
  return fetchChileRawPage(unit, ctx, { binary: true, maxBytes: BULK_MAX_RESPONSE_BYTES });
}

/** Columns the loaders cannot work without. A missing one means the export format drifted. */
export const BULK_REQUIRED_COLUMNS = {
  lic: ['CodigoExterno', 'Nombre', 'CodigoEstado', 'Estado', 'CodigoUnidad', 'Codigoitem', 'RutProveedor'],
  oc: ['Codigo', 'Nombre', 'codigoEstado', 'Estado', 'CodigoUnidadCompra', 'RutSucursal', 'MontoTotalOC'],
  erroneous: ['idoc', 'numoc'],
} as const;

/** One entry of the erroneous purchase order list. */
export interface ErroneousPo {
  idoc: string;
  nroLicitacion: string | null;
}

/** Parse `hist_OC_erroneas.csv` into a map keyed by PO code (`numoc`). */
export function parseErroneousPoList(bytes: Uint8Array): Map<string, ErroneousPo> {
  const rows = parseCsvText(decodeLatin1(bytes), ';');
  const header = normalizeCsvHeader(rows[0] ?? []);
  const missing = BULK_REQUIRED_COLUMNS.erroneous.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new PsSourceError('schema', `Erroneous PO list is missing columns: ${missing.join(', ')}`, { doNotRetry: true });
  }
  const iId = header.indexOf('idoc');
  const iNum = header.indexOf('numoc');
  const iLic = header.indexOf('NroLicitacion');
  const out = new Map<string, ErroneousPo>();
  for (const row of rows.slice(1)) {
    const numoc = str(row[iNum]);
    if (numoc) out.set(numoc, { idoc: row[iId] ?? '', nroLicitacion: str(row[iLic]) });
  }
  return out;
}

/** Context for the bulk loaders. */
export interface BulkLoadContext extends PsNormalizeContext {
  retrievedAt: Date;
  /** Credential-free URL of the file the rows came from. */
  apiUrl: string;
  /** SHA-256 of the fetched archive bytes; defaults to the hash of the CSV bytes. */
  rawPayloadHash?: string;
}

type Chunks = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
type Row = Record<string, string>;

async function* hashing(chunks: Chunks, hash: ReturnType<typeof createHash>): AsyncGenerator<Uint8Array> {
  for await (const c of chunks) {
    hash.update(c);
    yield c;
  }
}

const OFFER_CURRENCY: Record<string, string> = {
  'Peso Chileno': 'CLP',
  Dolar: 'USD',
  'Dólar': 'USD',
  Euro: 'EUR',
  'Unidad de Fomento': 'CLF',
  'Unidad Tributaria Mensual': 'UTM',
};

function entityFromRow(
  prov: ChileProvenance,
  f: { code: string | null; taxId: string | null; name: string | null; organismCode: string | null; organismName: string | null; sector: string | null; region: string | null; comuna: string | null },
  tier: number,
): PsPublicEntity | null {
  if (!f.code) return null;
  const name = f.name ?? f.organismName ?? f.code;
  return finalizeRecord<PsPublicEntity>({
    kind: 'public_entity',
    country: 'CL',
    ...prov,
    externalId: f.code,
    sourceUrl: buyerUnitUrl(f.code),
    publishedAt: null,
    sourceUpdatedAt: null,
    taxId: f.taxId,
    name,
    normalizedName: normalizeEntityName(name),
    organismCode: f.organismCode,
    organismName: f.organismName,
    sector: f.sector,
    region: f.region,
    comuna: f.comuna,
    confidenceBps: computeConfidenceBps({ tier, required: [f.taxId, name] }),
    raw: f,
  });
}

function supplierFromRow(
  prov: ChileProvenance,
  ctx: PsNormalizeContext,
  rut: string | undefined,
  name: string | null,
  code: string | null,
  sourceUrl: string,
): PsSupplier | null {
  const who = supplierIdentity(rut, ctx);
  if (!who) return null;
  const display = name ?? who.externalId;
  return finalizeRecord<PsSupplier>({
    kind: 'supplier',
    country: 'CL',
    ...prov,
    sourceUrl,
    publishedAt: null,
    sourceUpdatedAt: null,
    ...who,
    name: display,
    normalizedName: normalizeEntityName(display),
    sourceSupplierCode: code,
    confidenceBps: computeConfidenceBps({ tier: SOURCE_TIER.officialBulk, required: [display] }),
    raw: who.isNaturalPerson ? { naturalPerson: true, code } : { rut, name, code },
  });
}

function setPayloadHash(n: PsNormalized, hash: string): PsNormalized {
  for (const bucket of [n.entities, n.opportunities, n.suppliers, n.offers, n.purchaseOrders]) {
    for (const rec of bucket) rec.rawPayloadHash = hash;
  }
  return n;
}

function provenance(sourceKey: string, ctx: BulkLoadContext): ChileProvenance {
  return {
    sourceKey,
    apiUrl: ctx.apiUrl,
    retrievedAt: ctx.retrievedAt,
    rawPayloadHash: ctx.rawPayloadHash ?? '',
    licence: CHILE_LICENCES.bulk,
    attribution: CHILECOMPRA_ATTRIBUTION,
  };
}

/** Load the tender file with line items and offers received (`lic-da`). */
export async function loadLicitacionesCsv(chunks: Chunks, ctx: BulkLoadContext): Promise<PsNormalized> {
  const sourceKey = 'cl.da.lic';
  const prov = provenance(sourceKey, ctx);
  const col = new NormalizedCollector(ctx.hashTaxId);
  const hash = createHash('sha256');
  const tenders = new Map<string, { first: Row; unspsc: Set<string> }>();

  for await (const row of iterateCsvRecords(hashing(chunks, hash), { requiredColumns: BULK_REQUIRED_COLUMNS.lic })) {
    const code = str(row.CodigoExterno);
    if (!code) continue;
    const t = tenders.get(code) ?? { first: row, unspsc: new Set<string>() };
    const unspsc = str(row.CodigoProductoONU);
    if (unspsc) t.unspsc.add(unspsc);
    tenders.set(code, t);

    const ficha = tenderFichaUrl(code);
    const supplier = supplierFromRow(prov, ctx, row.RutProveedor, str(row.NombreProveedor), str(row.CodigoProveedor), ficha);
    if (!supplier) continue;
    col.add('suppliers', supplier);
    const selected = str(row['Oferta seleccionada']) === 'Seleccionada';
    const offered = amountMicros(row['Valor Total Ofertado']);
    const lineId = str(row.Codigoitem);
    col.add(
      'offers',
      finalizeRecord<PsOffer>({
        kind: 'offer',
        country: 'CL',
        ...prov,
        externalId: [
          code,
          str(row.Correlativo) ?? 'na',
          lineId ?? 'na',
          supplier.externalId,
          str(row.CodigoSucursalProveedor) ?? 'na',
          sha256Hex(str(row['Nombre de la Oferta']) ?? '').slice(0, 12),
        ].join(':'),
        sourceUrl: ficha,
        publishedAt: null,
        sourceUpdatedAt: null,
        opportunityExternalId: code,
        supplierExternalId: supplier.externalId,
        lineId,
        unspsc,
        offeredAmountMicros: offered,
        awardedAmountMicros: selected ? amountMicros(row.MontoLineaAdjudica) : null,
        awardedQuantity: selected ? int(row.CantidadAdjudicada) : null,
        currencyCode: OFFER_CURRENCY[row['Moneda de la Oferta'] ?? ''] ?? str(row.CodigoMoneda),
        selected,
        offerStatus: str(row['Estado Oferta']),
        submittedAt: chileDate(row.FechaEnvioOferta),
        confidenceBps: computeConfidenceBps({ tier: SOURCE_TIER.officialBulk, required: [offered, lineId] }),
        raw: row,
      }),
    );
  }

  for (const [code, { first: row, unspsc }] of tenders) {
    const entity = entityFromRow(
      prov,
      {
        code: str(row.CodigoUnidad),
        taxId: str(row.RutUnidad),
        name: str(row.NombreUnidad),
        organismCode: str(row.CodigoOrganismo),
        organismName: str(row.NombreOrganismo),
        sector: str(row.sector),
        region: str(row.RegionUnidad),
        comuna: str(row.ComunaUnidad),
      },
      SOURCE_TIER.officialBulk,
    );
    if (entity) col.add('entities', entity);
    const statusCode = int(row.CodigoEstado);
    const stage = tenderStage(statusCode, str(row.Estado));
    const bidderCount = int(row.NumeroOferentes);
    const title = str(row.Nombre) ?? code;
    const closesAt = chileDate(row.FechaCierre);
    col.add(
      'opportunities',
      finalizeRecord<PsOpportunity>({
        kind: 'opportunity',
        country: 'CL',
        ...prov,
        externalId: code,
        sourceUrl: tenderFichaUrl(code),
        publishedAt: chileDate(row.FechaPublicacion),
        sourceUpdatedAt: null,
        ocid: `ocds-70d2nz-${code}`,
        title,
        description: str(row.Descripcion),
        buyerExternalId: entity?.externalId ?? null,
        stage,
        statusCode,
        statusLabel: str(row.Estado),
        procurementMethod: str(row.TipoConvocatoria) === '0' ? 'selective' : 'open',
        procurementMethodDetails: str(row['Tipo de Adquisicion']) ?? str(row.Tipo),
        isDirectAward: false,
        closesAt,
        awardedAt: chileDate(row.FechaAdjudicacion),
        estimatedValueMicros: amountMicros(row.MontoEstimado),
        currencyCode: str(row.CodigoMoneda),
        unspscCodes: [...unspsc].sort(),
        region: str(row.RegionUnidad),
        bidderCount,
        confidenceBps: computeConfidenceBps({
          tier: SOURCE_TIER.officialBulk,
          required: [title, entity, stage, closesAt],
        }),
        raw: row,
      }),
    );
    if (bidderCount === 1) {
      col.flag(createReviewFlag('single_bidder', { kind: 'opportunity', externalId: code, sourceKey }));
    }
  }
  return setPayloadHash(col.out, ctx.rawPayloadHash ?? hash.digest('hex'));
}

/** Load the purchase order file (`oc-da`), flagging POs on the erroneous list. */
export async function loadOrdenesCompraCsv(
  chunks: Chunks,
  ctx: BulkLoadContext & { erroneous: Map<string, ErroneousPo> },
): Promise<PsNormalized> {
  const sourceKey = 'cl.da.oc';
  const prov = provenance(sourceKey, ctx);
  const col = new NormalizedCollector(ctx.hashTaxId);
  const hash = createHash('sha256');
  const orders = new Map<string, Row[]>();

  for await (const row of iterateCsvRecords(hashing(chunks, hash), { requiredColumns: BULK_REQUIRED_COLUMNS.oc })) {
    const code = str(row.Codigo);
    if (!code) continue;
    const lines = orders.get(code);
    if (lines) lines.push(row);
    else orders.set(code, [row]);
  }

  for (const [code, lines] of orders) {
    const row = lines[0]!;
    const sourceUrl = purchaseOrderUrl(code);
    const entity = entityFromRow(
      prov,
      {
        code: str(row.CodigoUnidadCompra),
        taxId: str(row.RutUnidadCompra),
        name: str(row.UnidadCompra),
        organismCode: str(row.CodigoOrganismoPublico),
        organismName: str(row.OrganismoPublico),
        sector: str(row.sector),
        region: str(row.RegionUnidadCompra),
        comuna: null,
      },
      SOURCE_TIER.officialBulk,
    );
    if (entity) col.add('entities', entity);
    const supplier = supplierFromRow(prov, ctx, row.RutSucursal, str(row.NombreProveedor), str(row.CodigoProveedor), sourceUrl);
    if (supplier) col.add('suppliers', supplier);

    const listed = ctx.erroneous.has(code);
    const isDirectAward = str(row.EsTratoDirecto) === 'Si';
    const statusCode = int(row.codigoEstado);
    const stage = purchaseOrderStage(statusCode, str(row.Estado));
    const amount = amountMicros(row.MontoTotalOC);
    col.add(
      'purchaseOrders',
      finalizeRecord<PsPurchaseOrder>({
        kind: 'purchase_order',
        country: 'CL',
        ...prov,
        externalId: code,
        sourceUrl,
        publishedAt: chileDate(row.FechaCreacion),
        sourceUpdatedAt: chileDate(row.fechaUltimaModificacion),
        title: str(row.Nombre),
        buyerExternalId: entity?.externalId ?? null,
        supplierExternalId: supplier?.externalId ?? null,
        opportunityExternalId: str(row.CodigoLicitacion),
        stage,
        statusCode,
        statusLabel: str(row.Estado),
        amountMicros: amount,
        currencyCode: str(row.TipoMonedaOC),
        issuedAt: chileDate(row.FechaEnvio),
        isDirectAward,
        excludedFromOfficial: listed,
        exclusionReason: listed ? 'listed_in_hist_OC_erroneas' : null,
        confidenceBps: computeConfidenceBps({
          tier: SOURCE_TIER.officialBulk,
          required: [amount, entity, supplier, stage],
          excludedFromOfficial: listed,
        }),
        raw: lines,
      }),
    );
    if (isDirectAward) {
      col.flag(createReviewFlag('direct_award', { kind: 'purchase_order', externalId: code, sourceKey }));
    }
  }
  return setPayloadHash(col.out, ctx.rawPayloadHash ?? hash.digest('hex'));
}

/**
 * Sum PO amounts per currency. `official` leaves out POs ChileCompra lists as
 * erroneous (the default view); `raw` includes every stored PO.
 */
export function sumPurchaseOrderAmounts(
  pos: readonly PsPurchaseOrder[],
  view: 'official' | 'raw' = 'official',
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const po of pos) {
    if (view === 'official' && po.excludedFromOfficial) continue;
    if (po.amountMicros === null || !po.currencyCode) continue;
    totals.set(po.currencyCode, (totals.get(po.currencyCode) ?? 0n) + po.amountMicros);
  }
  return totals;
}
