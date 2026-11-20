/**
 * Public sector intelligence: country adapter contract (spec section 3.2).
 *
 * Pure types. Adapters run against injected fetch functions and recorded
 * fixtures, with no database and no network of their own.
 */

/** Countries with a planned adapter. */
export type PsCountry = 'CL' | 'CO' | 'BR' | 'PE' | 'MX';

/** Procurement stages kept separate on every record and in every answer. */
export const PS_STAGES = ['planned', 'active', 'awarded', 'ordered', 'paid', 'cancelled'] as const;

/** One procurement stage. `null` on a record means the source status is unmapped. */
export type PsStage = (typeof PS_STAGES)[number];

/** The kinds of normalized record an adapter can emit. */
export type PsRecordKind = 'public_entity' | 'opportunity' | 'supplier' | 'offer' | 'purchase_order';

/** Fetch signature shared with `createSafeFetch` and `createResearchFetch`. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Traceability carried by every normalized record (spec section 3.5).
 *
 * `retrievedAt` is when Polo fetched it (fetched_at); `sourceUpdatedAt` is the
 * source's own last update (last_updated). `raw` is the source payload the
 * record came from (a CSV row or an OCDS release), kept for review.
 */
export interface PsRecordBase {
  kind: PsRecordKind;
  country: PsCountry;
  sourceKey: string;
  externalId: string;
  /** `${sourceKey}:${kind}:${externalId}`: the natural key for idempotent upserts. */
  idempotencyKey: string;
  /** Canonical human link (ficha page), never a credentialed URL. */
  sourceUrl: string;
  /** The request that produced the record, credential stripped. */
  apiUrl: string;
  publishedAt: Date | null;
  sourceUpdatedAt: Date | null;
  retrievedAt: Date;
  licence: string;
  attribution: string;
  /** SHA-256 of the canonical projection of this record (spec 3.4). */
  recordHash: string;
  /** SHA-256 of the exact raw bytes the record was parsed from. */
  rawPayloadHash: string;
  /** Computed confidence, 0 to 10,000 basis points. */
  confidenceBps: number;
  raw: unknown;
}

/** A buyer: organismo or purchasing unit. */
export interface PsPublicEntity extends PsRecordBase {
  kind: 'public_entity';
  /** Institution tax id (RUT of a public body, public by law). */
  taxId: string | null;
  name: string;
  normalizedName: string;
  organismCode: string | null;
  organismName: string | null;
  sector: string | null;
  region: string | null;
  comuna: string | null;
}

/** A procurement opportunity (tender, direct award or framework purchase). */
export interface PsOpportunity extends PsRecordBase {
  kind: 'opportunity';
  ocid: string | null;
  title: string;
  description: string | null;
  buyerExternalId: string | null;
  stage: PsStage | null;
  statusCode: number | null;
  statusLabel: string | null;
  procurementMethod: 'open' | 'selective' | 'limited' | 'direct' | null;
  procurementMethodDetails: string | null;
  isDirectAward: boolean;
  closesAt: Date | null;
  awardedAt: Date | null;
  estimatedValueMicros: bigint | null;
  currencyCode: string | null;
  unspscCodes: string[];
  region: string | null;
  bidderCount: number | null;
}

/** A supplier or competitor. Natural persons keep a display name and a keyed hash only. */
export interface PsSupplier extends PsRecordBase {
  kind: 'supplier';
  /** Company RUT; `null` for natural persons. */
  taxId: string | null;
  /** HMAC of the RUT for natural persons; `null` for companies. */
  taxIdHash: string | null;
  isNaturalPerson: boolean;
  name: string;
  normalizedName: string;
  sourceSupplierCode: string | null;
}

/** An offer received, or the winning offer recorded by an award. */
export interface PsOffer extends PsRecordBase {
  kind: 'offer';
  opportunityExternalId: string;
  supplierExternalId: string;
  lineId: string | null;
  unspsc: string | null;
  offeredAmountMicros: bigint | null;
  awardedAmountMicros: bigint | null;
  awardedQuantity: number | null;
  currencyCode: string | null;
  selected: boolean;
  offerStatus: string | null;
  submittedAt: Date | null;
}

/** A purchase order (ordered stage). */
export interface PsPurchaseOrder extends PsRecordBase {
  kind: 'purchase_order';
  title: string | null;
  buyerExternalId: string | null;
  supplierExternalId: string | null;
  opportunityExternalId: string | null;
  stage: PsStage | null;
  statusCode: number | null;
  statusLabel: string | null;
  amountMicros: bigint | null;
  currencyCode: string | null;
  issuedAt: Date | null;
  isDirectAward: boolean;
  /** Listed by ChileCompra as erroneous: kept, but left out of official totals. */
  excludedFromOfficial: boolean;
  exclusionReason: string | null;
}

/** Neutral review flag kinds. */
export type PsReviewFlagKind = 'direct_award' | 'single_bidder';

/** A neutral "requires review" flag. Never an accusation. */
export interface PsReviewFlag {
  kind: PsReviewFlagKind;
  targetKind: 'opportunity' | 'purchase_order';
  targetExternalId: string;
  sourceKey: string;
  label: string;
  description: string;
  status: 'open';
}

/** Everything one raw page normalizes into. */
export interface PsNormalized {
  entities: PsPublicEntity[];
  opportunities: PsOpportunity[];
  suppliers: PsSupplier[];
  offers: PsOffer[];
  purchaseOrders: PsPurchaseOrder[];
  reviewFlags: PsReviewFlag[];
}

/** One planned HTTP request. URLs never carry a credential. */
export interface PsFetchUnit {
  sourceKey: string;
  kind: string;
  url: string;
}

/** One fetched page, as indexed by the raw store. */
export interface PsRawPage {
  unit: PsFetchUnit;
  httpStatus: number;
  requestUrlRedacted: string;
  retrievedAt: Date;
  contentType: string | null;
  /** Lowercase hex SHA-256 of the exact body bytes (spec 3.4). */
  rawPayloadHash: string;
  bytes: number;
  /** UTF-8 text of the body. Empty for binary units, which carry `bodyBytes`. */
  body: string;
  /** Exact body bytes, set for binary units (bulk ZIP archives). */
  bodyBytes?: Uint8Array;
}

/** Options every normalizer needs. */
export interface PsNormalizeContext {
  /** Keyed hash for natural-person tax ids (see `createTaxIdHasher`). */
  hashTaxId: (taxId: string) => string;
}

/** Per-call quota reservation, checked before each request. */
export interface PsQuotaReserver {
  reserve(): Promise<{ used: number; remaining: number }>;
}

/** Context passed to `PsAdapter.fetch`. */
export interface PsFetchContext {
  fetch: FetchLike;
  /** Credential value, resolved by the caller from its NAME. Never logged. */
  secret?: string;
  quota?: PsQuotaReserver;
  now?: () => Date;
}

/** The country adapter contract (spec section 3.2). */
export interface PsAdapter<Cursor = unknown> {
  country: PsCountry;
  sourceKey: string;
  credentialName: string | null;
  licence: string;
  attribution: string;
  budget: {
    perDay?: number;
    perMinute?: number;
    quietHoursLocal?: readonly [number, number];
    timeZone: string;
  };
  plan(window: { from: Date; to: Date }, cursor: Cursor | null): PsFetchUnit[];
  fetch(unit: PsFetchUnit, ctx: PsFetchContext): Promise<PsRawPage>;
  normalize(raw: PsRawPage, ctx: PsNormalizeContext): PsNormalized;
  nextCursor(raw: PsRawPage, cursor: Cursor | null): Cursor | null;
}
