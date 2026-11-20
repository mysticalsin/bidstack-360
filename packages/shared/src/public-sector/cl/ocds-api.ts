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

import { CHILE_LICENCES, CHILECOMPRA_ATTRIBUTION } from '../attribution.js';
import { computeConfidenceBps, SOURCE_TIER } from '../confidence.js';
import { PsSourceError } from '../errors.js';
import { assertAllowedSourceUrl, CHILE_SOURCE_HOSTS } from '../fetch-guard.js';
import { CHILE_TIME_ZONE } from '../quota.js';
import { createReviewFlag } from '../review-flags.js';
import { parseRut } from '../rut.js';
import { zonedParts } from '../time.js';
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

/** Stream key for records built from OCDS award releases (see `normalize`). */
export const OCDS_AWARD_SOURCE_KEY = 'cl.mp.ocds.award';
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

const TERMINAL_TENDER_STATUSES = new Set(['complete', 'cancelled', 'unsuccessful', 'withdrawn']);

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
  seenAwards: Set<string>,
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
          raw: who.isNaturalPerson ? { id: party.id, naturalPerson: true } : party,
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
    col.flag(createReviewFlag('direct_award', { kind: 'opportunity', externalId: code, sourceKey: prov.sourceKey }));
  }

  for (const award of awards) {
    // Releases arrive newest first: the first state seen for an award is its
    // latest, so an older active copy cannot revive a cancelled award.
    const awardKey = `${code}:${award.id}`;
    if (seenAwards.has(awardKey)) continue;
    seenAwards.add(awardKey);
    if (award.status !== 'active') continue;
    const awardSuppliers = award.suppliers ?? [];
    // One award value shared by several suppliers cannot be split honestly.
    const amount = awardSuppliers.length === 1 ? amountMicros(award.value?.amount) : null;
    for (const s of awardSuppliers) {
      const supplierExternalId = supplierIds.get(s.id);
      if (!supplierExternalId) continue;
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

/** Hard stop for one month's listing (about 1M records at the default page size). */
export const OCDS_MAX_PAGES = 10_000;

/** The OCDS API adapter. */
export const ocdsAdapter: PsAdapter<OcdsCursor> = {
  country: 'CL',
  sourceKey: SOURCE_KEY,
  credentialName: null,
  licence: CHILE_LICENCES.ocds,
  attribution: CHILECOMPRA_ATTRIBUTION,
  budget: { timeZone: CHILE_TIME_ZONE },

  plan(window, cursor) {
    if (cursor) return [{ sourceKey: SOURCE_KEY, kind: 'ocds.list', url: ocdsListUrl(cursor) }];
    const units: PsFetchUnit[] = [];
    const from = zonedParts(window.from, CHILE_TIME_ZONE);
    const to = zonedParts(window.to, CHILE_TIME_ZONE);
    const end = to.year * 12 + (to.month - 1);
    for (let m = from.year * 12 + (from.month - 1); m <= end; m += 1) {
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
    const col = new NormalizedCollector(ctx.hashTaxId);
    if (raw.unit.kind === 'ocds.list') return col.out;
    const pkg = parseJson(Package, raw.body);
    const licence = pkg.license?.includes('publicdomain/zero') ? CHILE_LICENCES.ocds : (str(pkg.license) ?? 'unstated');
    const base = provenanceFromRaw(raw, licence);
    // Tender and award endpoints describe the same process from different
    // releases. Until compiled-release merging lands, each endpoint is its own
    // stream so the two projections never share one idempotency key.
    const prov = raw.unit.kind === 'ocds.award' ? { ...base, sourceKey: OCDS_AWARD_SOURCE_KEY } : base;
    // ChileCompra stamps revocation tenderUpdates with the original publication
    // time, so a later Publicada release can sort after them. A terminal tender
    // status never reverts, so terminal releases win before date order applies.
    const terminal = (r: z.infer<typeof Release>) =>
      TERMINAL_TENDER_STATUSES.has(r.tender?.status ?? '') ? 1 : 0;
    const releases = [...pkg.releases].sort(
      (a, b) => terminal(b) - terminal(a) || (b.date ?? '').localeCompare(a.date ?? ''),
    );
    const seenAwards = new Set<string>();
    for (const release of releases) normalizeRelease(release, prov, ctx, col, seenAwards);
    return col.out;
  },

  nextCursor(raw) {
    const base = cursorFromUrl(raw.unit.url);
    if (!base) return null;
    const { pagination, data } = parseJson(ListPage, raw.body);
    // Advance from our own cursor, not the echoed offset, so a server that
    // repeats `offset: 0` cannot pin the loop. An empty or short page ends it.
    const offset = base.offset + base.limit;
    if (base.limit <= 0 || data.length === 0 || data.length < base.limit || offset >= pagination.total) return null;
    if (offset / base.limit > OCDS_MAX_PAGES) return null;
    const next: OcdsCursor = { year: base.year, month: base.month, offset, limit: base.limit };
    if (base.variant) next.variant = base.variant;
    return next;
  },
};
