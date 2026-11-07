/**
 * Chile: OCDS API adapter (no ticket), source key `cl.mp.ocds`.
 *
 * List: https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMes/{year}/{month}/{offset}/{limit}
 * Records: .../APISOCDS/OCDS/tender/{code} and .../award/{code}
 * Learned from: open-contracting/kingfisher-collect (BSD-3-Clause),
 * `kingfisher_scrapy/spiders/chile_compra_api_base.py` (list paging) and
 * `chile_compra_api_records.py`.
 *
 * Packages carry CC0 1.0. The list uses offset and limit with
 * `pagination.total`; list links are `http://`, upgraded to https here.
 * Tender and award releases are normalized independently; compiling them into
 * one record (ocds-merge rules) happens where both are stored.
 */

import { z } from 'zod';

import { CHILE_LICENCES } from '../attribution.js';
import { computeConfidenceBps, SOURCE_TIER } from '../confidence.js';
import { PsSourceError } from '../errors.js';
import { assertAllowedSourceUrl, CHILE_SOURCE_HOSTS } from '../fetch-guard.js';
import { CHILE_TIME_ZONE } from '../quota.js';
import { createReviewFlag } from '../review-flags.js';
import { parseRut } from '../rut.js';
import type {
  PsAdapter,
  PsFetchUnit,
  PsNormalizeContext,
  PsNormalized,
  PsOffer,
  PsOpportunity,
  PsPublicEntity,
  PsRawPage,
  PsStage,
  PsSupplier,
} from '../types.js';
import {
  amountMicros,
  buyerUnitUrl,
  chileDate,
  fetchChileRawPage,
  finalizeRecord,
  isTratoDirectoCode,
  normalizeEntityName,
  NormalizedCollector,
  provenanceFromRaw,
  purchaseOrderUrl,
  str,
  supplierIdentity,
  tenderFichaUrl,
  type ChileProvenance,
} from './common.js';

const SOURCE_KEY = 'cl.mp.ocds';
const OCDS_BASE = 'https://api.mercadopublico.cl/APISOCDS/OCDS';
const OCID_PREFIX = 'ocds-70d2nz-';
const DEFAULT_LIMIT = 100;

/** OCDS list variants: all tenders, direct awards, framework purchases. */
export type OcdsListVariant = 'TratoDirecto' | 'Convenio';

/** Paging cursor for the OCDS month list. */
export interface OcdsCursor {
  year: number;
  month: number;
  offset: number;
  limit: number;
  variant?: OcdsListVariant;
}

/** Month list URL. */
export function ocdsListUrl(c: OcdsCursor): string {
  const mm = String(c.month).padStart(2, '0');
  return `${OCDS_BASE}/listaOCDSAgnoMes${c.variant ?? ''}/${c.year}/${mm}/${c.offset}/${c.limit}`;
}

function cursorFromUrl(url: string): OcdsCursor | null {
  const m = /listaOCDSAgnoMes(TratoDirecto|Convenio)?\/(\d{4})\/(\d{2})\/(\d+)\/(\d+)$/.exec(url);
  if (!m) return null;
  const c: OcdsCursor = { year: Number(m[2]), month: Number(m[3]), offset: Number(m[4]), limit: Number(m[5]) };
  if (m[1]) c.variant = m[1] as OcdsListVariant;
  return c;
}

const ListPage = z.object({
  pagination: z.object({ offset: z.number(), limit: z.number(), total: z.number() }),
  data: z.array(
    z.object({ ocid: z.string(), urlTender: z.string().optional(), urlAward: z.string().optional() }).passthrough(),
  ),
});

const Value = z.object({ amount: z.number().nullish(), currency: z.string().nullish() }).passthrough();
const Period = z.object({ startDate: z.string().nullish(), endDate: z.string().nullish() }).passthrough();
const Item = z
  .object({ classification: z.object({ id: z.string(), scheme: z.string().nullish() }).passthrough().nullish() })
  .passthrough();
const Party = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    identifier: z.object({ id: z.string().nullish(), legalName: z.string().nullish(), scheme: z.string().nullish() }).nullish(),
    address: z.object({ region: z.string().nullish() }).passthrough().nullish(),
    roles: z.array(z.string()).default([]),
    additionalIdentifiers: z.array(z.object({ id: z.string(), scheme: z.string().nullish() }).passthrough()).nullish(),
  })
  .passthrough();
const Award = z
  .object({
    id: z.string(),
    title: z.string().nullish(),
    status: z.string().nullish(),
    statusDetails: z.string().nullish(),
    date: z.string().nullish(),
    value: Value.nullish(),
    suppliers: z.array(z.object({ id: z.string(), name: z.string().nullish() })).nullish(),
    items: z.array(Item).nullish(),
  })
  .passthrough();
const Release = z
  .object({
    ocid: z.string(),
    date: z.string().nullish(),
    tag: z.array(z.string()).default([]),
    parties: z.array(Party).default([]),
    tender: z
      .object({
        id: z.string().nullish(),
        title: z.string().nullish(),
        description: z.string().nullish(),
        status: z.string().nullish(),
        statusDetails: z.string().nullish(),
        value: Value.nullish(),
        items: z.array(Item).nullish(),
        procurementMethod: z.string().nullish(),
        procurementMethodDetails: z.string().nullish(),
        procurementMethodRationale: z.string().nullish(),
        tenderPeriod: Period.nullish(),
        numberOfTenderers: z.number().nullish(),
      })
      .passthrough()
      .nullish(),
    awards: z.array(Award).nullish(),
  })
  .passthrough();
const Package = z.object({ license: z.string().nullish(), releases: z.array(Release) }).passthrough();

function parseJson<S extends z.ZodTypeAny>(schema: S, body: string): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new PsSourceError('schema', 'OCDS API returned non-JSON', { doNotRetry: true });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new PsSourceError('schema', 'Unexpected OCDS response shape', { doNotRetry: true });
  return parsed.data;
}

/** Record units (tender and award) listed on one list page, over https. */
export function ocdsRecordUnits(raw: PsRawPage): PsFetchUnit[] {
  const page = parseJson(ListPage, raw.body);
  const units: PsFetchUnit[] = [];
  for (const row of page.data) {
    for (const [kind, url] of [
      ['ocds.tender', row.urlTender],
      ['ocds.award', row.urlAward],
    ] as const) {
      if (!url) continue;
      units.push({ sourceKey: SOURCE_KEY, kind, url: assertAllowedSourceUrl(url, CHILE_SOURCE_HOSTS).toString() });
    }
  }
  return units;
}

function statusCodeFrom(details: string | null | undefined): { code: number | null; label: string | null } {
  const m = /^(\d+)-(.*)$/.exec(details?.trim() ?? '');
  return m ? { code: Number(m[1]), label: m[2]!.trim() } : { code: null, label: str(details) };
}

function tenderStatusStage(status: string | null | undefined): PsStage | null {
  switch (status) {
    case 'planning':
    case 'planned':
      return 'planned';
    case 'active':
      return 'active';
    case 'complete':
      return 'awarded';
    case 'cancelled':
    case 'unsuccessful':
    case 'withdrawn':
      return 'cancelled';
    default:
      return null;
  }
}

function awardStage(awards: z.infer<typeof Award>[]): PsStage | null {
  if (awards.some((a) => a.status === 'active')) return 'awarded';
  if (awards.length > 0 && awards.every((a) => a.status === 'cancelled' || a.status === 'unsuccessful')) {
    return 'cancelled';
  }
  if (awards.some((a) => a.status === 'pending')) return 'active';
  return null;
}

function mpCode(party: z.infer<typeof Party>): string {
  const extra = party.additionalIdentifiers?.find((a) => a.scheme === 'CL-MP');
  return extra?.id ?? party.id.replace(/^CL-MP-/, '');
}

function partyName(party: z.infer<typeof Party>): string {
  return str(party.identifier?.legalName) ?? str(party.name?.split('|')[0]) ?? party.id;
}

function normalizeRelease(
  release: z.infer<typeof Release>,
  prov: ChileProvenance,
  ctx: PsNormalizeContext,
  col: NormalizedCollector,
): void {
  const tender = release.tender ?? null;
  const awards = release.awards ?? [];
  const code = str(tender?.id) ?? release.ocid.replace(OCID_PREFIX, '');
  const sourceUrl = isTratoDirectoCode(code) ? purchaseOrderUrl(code) : tenderFichaUrl(code);
  const sourceUpdatedAt = chileDate(release.date);

  let buyerId: string | null = null;
  const supplierIds = new Map<string, string>();
  for (const party of release.parties) {
    const rutScheme = party.identifier?.scheme === 'CL-RUT';
    if (party.roles.includes('buyer') || party.roles.includes('procuringEntity')) {
      const externalId = mpCode(party);
      buyerId = externalId;
      const name = partyName(party);
      const taxId = rutScheme ? (parseRut(party.identifier?.id)?.formatted ?? null) : null;
      col.add(
        'entities',
        finalizeRecord<PsPublicEntity>({
          kind: 'public_entity',
          country: 'CL',
          ...prov,
          externalId,
          sourceUrl: buyerUnitUrl(externalId),
          publishedAt: null,
          sourceUpdatedAt: null,
          taxId,
          name,
          normalizedName: normalizeEntityName(name),
          organismCode: null,
          organismName: null,
          sector: null,
          region: str(party.address?.region),
          comuna: null,
          confidenceBps: computeConfidenceBps({ tier: SOURCE_TIER.officialOcds, required: [taxId, name] }),
          raw: { id: party.id, identifier: party.identifier, roles: party.roles },
        }),
      );
    }
    if (party.roles.includes('supplier') && rutScheme) {
      const who = supplierIdentity(party.identifier?.id, ctx);
      if (!who) continue;
      supplierIds.set(party.id, who.externalId);
      const name = partyName(party);
      col.add(
        'suppliers',
        finalizeRecord<PsSupplier>({
          kind: 'supplier',
          country: 'CL',
          ...prov,
          sourceUrl,
          publishedAt: null,
          sourceUpdatedAt: null,
          ...who,
          name,
          normalizedName: normalizeEntityName(name),
          sourceSupplierCode: mpCode(party),
          confidenceBps: computeConfidenceBps({ tier: SOURCE_TIER.officialOcds, required: [name] }),
          raw: who.isNaturalPerson ? { id: party.id, name: party.name } : party,
        }),
      );
    }
  }

  const status = statusCodeFrom(tender?.statusDetails ?? awards[0]?.statusDetails);
  const stage = release.tag.includes('award') || !tender?.status ? awardStage(awards) : tenderStatusStage(tender.status);
  const method = tender?.procurementMethod ?? null;
  const procurementMethod =
    method === 'open' || method === 'selective' || method === 'limited' || method === 'direct' ? method : null;
  const isDirectAward = procurementMethod === 'direct' || isTratoDirectoCode(code);
  const unspsc = [...(tender?.items ?? []), ...awards.flatMap((a) => a.items ?? [])]
    .filter((i) => i.classification && (i.classification.scheme ?? 'UNSPSC') === 'UNSPSC')
    .map((i) => i.classification!.id);
  const title = str(tender?.title) ?? str(awards[0]?.title) ?? code;
  const closesAt = chileDate(tender?.tenderPeriod?.endDate);
  const awardedAt = chileDate(awards.find((a) => a.date)?.date);

  col.add(
    'opportunities',
    finalizeRecord<PsOpportunity>({
      kind: 'opportunity',
      country: 'CL',
      ...prov,
      externalId: code,
      sourceUrl,
      publishedAt: chileDate(tender?.tenderPeriod?.startDate),
      sourceUpdatedAt,
      ocid: release.ocid,
      title,
      description: str(tender?.description),
      buyerExternalId: buyerId,
      stage,
      statusCode: status.code,
      statusLabel: status.label,
      procurementMethod,
      procurementMethodDetails: str(tender?.procurementMethodDetails ?? tender?.procurementMethodRationale),
      isDirectAward,
      closesAt,
      awardedAt,
      estimatedValueMicros: amountMicros(tender?.value?.amount),
      currencyCode: str(tender?.value?.currency ?? awards.find((a) => a.value?.currency)?.value?.currency),
      unspscCodes: [...new Set(unspsc)].sort(),
      region: null,
      bidderCount: tender?.numberOfTenderers ?? null,
      confidenceBps: computeConfidenceBps({
        tier: SOURCE_TIER.officialOcds,
        required: [title, buyerId, stage, closesAt ?? awardedAt],
      }),
      raw: release,
    }),
  );
  if (isDirectAward) {
    col.flag(createReviewFlag('direct_award', { kind: 'opportunity', externalId: code, sourceKey: SOURCE_KEY }));
  }

  for (const award of awards) {
    if (award.status !== 'active') continue;
    for (const s of award.suppliers ?? []) {
      const supplierExternalId = supplierIds.get(s.id);
      if (!supplierExternalId) continue;
      const amount = amountMicros(award.value?.amount);
      col.add(
        'offers',
        finalizeRecord<PsOffer>({
          kind: 'offer',
          country: 'CL',
          ...prov,
          externalId: `${code}:award:${award.id}:${supplierExternalId}`,
          sourceUrl,
          publishedAt: awardedAt,
          sourceUpdatedAt,
          opportunityExternalId: code,
          supplierExternalId,
          lineId: null,
          unspsc: null,
          offeredAmountMicros: null,
          awardedAmountMicros: amount,
          awardedQuantity: null,
          currencyCode: str(award.value?.currency),
          selected: true,
          offerStatus: str(award.statusDetails),
          submittedAt: null,
          confidenceBps: computeConfidenceBps({ tier: SOURCE_TIER.officialOcds, required: [amount] }),
          raw: award,
        }),
      );
    }
  }
}

/** The OCDS API adapter. */
export const ocdsAdapter: PsAdapter<OcdsCursor> = {
  country: 'CL',
  sourceKey: SOURCE_KEY,
  credentialName: null,
  licence: CHILE_LICENCES.ocds,
  attribution: 'Dirección ChileCompra',
  budget: { timeZone: CHILE_TIME_ZONE },

  plan(window, cursor) {
    if (cursor) return [{ sourceKey: SOURCE_KEY, kind: 'ocds.list', url: ocdsListUrl(cursor) }];
    const units: PsFetchUnit[] = [];
    const end = window.to.getUTCFullYear() * 12 + window.to.getUTCMonth();
    for (let m = window.from.getUTCFullYear() * 12 + window.from.getUTCMonth(); m <= end; m += 1) {
      const c: OcdsCursor = { year: Math.floor(m / 12), month: (m % 12) + 1, offset: 0, limit: DEFAULT_LIMIT };
      units.push({ sourceKey: SOURCE_KEY, kind: 'ocds.list', url: ocdsListUrl(c) });
    }
    return units;
  },

  async fetch(unit, ctx) {
    await ctx.quota?.reserve();
    return fetchChileRawPage(unit, ctx);
  },

  normalize(raw, ctx): PsNormalized {
    const col = new NormalizedCollector();
    if (raw.unit.kind === 'ocds.list') return col.out;
    const pkg = parseJson(Package, raw.body);
    const licence = pkg.license?.includes('publicdomain/zero') ? CHILE_LICENCES.ocds : (str(pkg.license) ?? 'unstated');
    const prov = provenanceFromRaw(raw, licence);
    for (const release of pkg.releases) normalizeRelease(release, prov, ctx, col);
    return col.out;
  },

  nextCursor(raw) {
    const base = cursorFromUrl(raw.unit.url);
    if (!base) return null;
    const { pagination } = parseJson(ListPage, raw.body);
    const offset = pagination.offset + pagination.limit;
    if (pagination.limit <= 0 || offset >= pagination.total) return null;
    const next: OcdsCursor = { year: base.year, month: base.month, offset, limit: pagination.limit };
    if (base.variant) next.variant = base.variant;
    return next;
  },
};
