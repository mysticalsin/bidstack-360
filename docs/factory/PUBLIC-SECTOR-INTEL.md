# Public Sector Intelligence: spec (factory slice 8a)

Status: spec only, no product code. Owner: Tony (product), factory agents (build).
Researched 2026-11-06 against live endpoints. Every fact below marked **verified**
was observed in a real response or an official page on that date; anything else is
marked **unverified** with the reason.

Scope: a Public Sector Intelligence section in Polo that ingests public procurement
data from official sources, starting with Chile (slice 8b), then Colombia, Brazil,
Peru and Mexico (slice 8c). It recommends; it never decides, submits, or contacts.

---

## 1. Source facts per country

### 1.1 Chile (8b MVP)

Three official channels, all run by Dirección ChileCompra.

**A. Mercado Público REST API (ticketed).** Terms page: <https://www.chilecompra.cl/api/>
(the old `api.mercadopublico.cl/modules/*.aspx` pages now redirect there).

| Item | Fact | Status |
|---|---|---|
| Base | `https://api.mercadopublico.cl/servicios/v1/publico/` | verified |
| Tenders | `licitaciones.json?codigo=` / `?fecha=DDMMYYYY` / `?estado=activas` / `?estado=<estado>&fecha=` / `?fecha=&CodigoOrganismo=` / `?fecha=&CodigoProveedor=` | verified (docs) |
| Purchase orders | `ordenesdecompra.json` with the same `codigo`, `fecha`, `estado=todos`, organismo and proveedor filters | verified (docs) |
| Directory | `Publico/Empresas/BuscarProveedor?rutempresaproveedor=70.017.820-k`, `Publico/Empresas/BuscarComprador` | verified (docs) |
| Formats | `.json`, `.jsonp` (`callback=`), `.xml` | verified (docs) |
| Auth | `ticket=` query parameter. One ticket per person, requested with Clave Única after accepting the terms; code arrives by email. Real name, RUT and email required | verified |
| Rate limit | 10,000 requests per ticket per day, not negotiable. IP-based monitoring with possible per-IP restriction. Bulk work recommended 22:00 to 07:00 (Chile time) | verified |
| Bad ticket | HTTP 203 with body `{"Codigo":203,"Mensaje":"Ticket no válido."}` (not 401) | verified |
| Tender status codes | Publicada 5, Cerrada 6, Desierta 7, Adjudicada 8, Revocada 18, Suspendida 19 | verified (docs) |
| PO status codes | Enviada a proveedor 4, En proceso 5, Aceptada 6, Cancelada 9, Recepción conforme 12, Pendiente de recepcionar 13, Recepcionada parcialmente 14, Recepción conforme incompleta 15 | verified (docs) |
| Pagination | none; queries are scoped by day, code, entity or supplier | verified (docs) |
| Attribution | Anyone publishing API data without modification must state clearly that the source is Dirección ChileCompra | verified |
| Support | only via ayuda.mercadopublico.cl with Clave Única | verified |
| Change notice | ChileCompra may change or end the service; it says format changes will be announced in advance. It held an API co-creation consultation in early 2026, so expect changes | verified |

**B. OCDS API (no ticket).** Found in the Datos Abiertos bundle and confirmed live.

| Item | Fact | Status |
|---|---|---|
| List | `https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMes/{year}/{month}/{offset}/{limit}`; variants `...TratoDirecto/` and `...Convenio/` | verified (200, `pagination.total` 10,328 for 2025-07 tenders) |
| Records | `.../APISOCDS/OCDS/tender/{code}`, `.../award/{code}` (list returns `urlTender`, `urlAward`) | verified |
| Shape | release package: `uri, version, publishedDate, releases[], publisher, license, publicationPolicy`; release has `ocid, id, date, tag, initiationType, parties, tender` | verified |
| OCID prefix | `ocds-70d2nz` | verified |
| Licence | CC0 1.0 (`license` field in every package) | verified |
| Throughput | Kingfisher Collect notes a full backfill takes more than a month; it only pulls 2022 onward | verified (third-party note) |
| Version quirk | list says OCDS `1.2`, record package says `1.1` | verified |

**C. Datos Abiertos bulk files (no auth).** Page: <https://datos-abiertos.chilecompra.cl/descargas>.

| File | URL pattern | Notes | Status |
|---|---|---|---|
| Tenders with line items and offers received | `https://transparenciachc.blob.core.windows.net/lic-da/{YYYY}-{M}.zip` | 2025-7 zip 17.8 MB, CSV 287 MB, Latin-1, `;` delimited, one row per line item per offer. Columns include `CodigoExterno, CodigoEstado, CodigoOrganismo, NombreOrganismo, RegionUnidad, FechaCierre, MontoEstimado, CodigoProductoONU, RutProveedor, NombreProveedor, Valor Total Ofertado, MontoLineaAdjudica, Oferta seleccionada` | verified |
| Purchase orders | `https://transparenciachc.blob.core.windows.net/oc-da/{YYYY}-{M}.zip` | 2025-7 zip 105 MB | verified (HEAD) |
| Erroneous POs (excluded from official figures) | `.../oc-da/hist_OC_erroneas.csv` | columns `idoc; numoc; NroLicitacion` | verified |
| Currency parity | `.../oc-da/ParidadMoneda.csv`, `.../oc-da/hist_moneda_H_vs_I.csv` | needed for currency normalisation | verified (HEAD) |
| Buyers, UNSPSC list, framework catalogue | `.../oc-da/Instituciones_compradoras.zip`, `.../oc-da/Listado_rubros_ONU.xlsx`, `.../maestrascm/CM_publicados.csv`, `.../oc-da/OC_CFMP.zip` | reference data | referenced in bundle, not each fetched |
| Annual procurement plans, Compra Ágil, OCDS bulk | hosts `pac-files.da.mercadopublico.cl`, `gcompras-files.da.mercadopublico.cl`, `ocds-lic-files.da.mercadopublico.cl`, `ocds.blob.core.windows.net/ocds/{YYYYMM}.zip` | `ocds/202507.zip` returned 404; exact current paths need a browser session | **unverified** |

Raw versus processed: keep every raw row, and mark rows listed in
`hist_OC_erroneas.csv` as `excludedFromOfficial = true` rather than dropping them.
Aggregates default to the official view; the raw view stays one toggle away.

### 1.2 Colombia (8c)

| Item | Fact | Status |
|---|---|---|
| Contracts | SECOP II Contratos Electrónicos, Socrata dataset `jbjy-vk9h`, `https://www.datos.gov.co/resource/jbjy-vk9h.json` | verified, 5,687,362 rows |
| Processes | SECOP II Procesos de Contratación `p6dx-8zbt` | verified (metadata) |
| Query | SoQL: `$select, $where, $order, $limit, $offset`; order by a stable key when paging | verified |
| Freshness | `X-SODA2-Truth-Last-Modified` header (2026-11-06 12:43 GMT) and `rowsUpdatedAt` in `/api/views/{id}.json` | verified |
| Auth | none needed; optional app token (`X-App-Token`). Without one, throttling is per IP from a shared pool; with one, Socrata says it does not throttle unless abusive. Throttled calls get 429 | verified (Socrata docs) |
| Licence | CC BY-SA 4.0, attribution "Agencia Nacional de Contratación Pública - Colombia Compra Eficiente" | verified. **Share-alike**: any data product we publish externally from it must carry the same licence |
| Personal data | the contracts table includes individual contractors' cédula numbers, legal representative IDs and gender, supervisor names and IDs, bank name, account type and **account number** | verified. Drop these columns at ingestion (section 6.3) |
| OCDS | Colombia Compra Eficiente is listed in the OCDS Data Registry; Kingfisher no longer has a live spider for it | partially verified |

### 1.3 Brazil (8c)

| Item | Fact | Status |
|---|---|---|
| API | Compras.gov.br Dados Abertos, OpenAPI at `https://dadosabertos.compras.gov.br/v3/api-docs` (77 paths) | verified |
| Key paths | `/modulo-contratacoes/1_consultarContratacoes_PNCP_14133` (required `dataPublicacaoPncpInicial`, `dataPublicacaoPncpFinal`, `codigoModalidade`), `/modulo-contratos/1_consultarContratos`, `/modulo-pgc/1_consultarPgcDetalhe` (annual plan, `orgao`, `anoPcaProjetoCompra`), `/modulo-pesquisa-preco/*` (price research), `/modulo-fornecedor/1_consultarFornecedor`, `/modulo-ocds/1_releases` (`buyerID`, `releaseStartDate`, `releaseEndDate`, `page`, `offSet`), `/modulo-legado/*` (pre-14.133) | verified |
| Paging | `pagina`, `tamanhoPagina`; response carries `totalRegistros, totalPaginas, paginasRestantes` | verified |
| Auth | read endpoints are open. `bearerAuth` only on the user and `/alice/*` modules | verified |
| Rate limit | undocumented; Kingfisher Collect throttles to about 100 requests per minute | verified (third-party note) |
| `pesquisa-preco` | the strongest public price-benchmark source of the five countries | verified (paths), data quality unassessed |
| Licence | not stated in the OpenAPI document | **unverified** |

### 1.4 Peru (8c)

| Item | Fact | Status |
|---|---|---|
| OECE OCDS API | `https://contratacionesabiertas.oece.gob.pe/api/v1/{records,releases,files}?format=json` (bulk list `files?page=&paginateBy=`) per Kingfisher Collect source | endpoints **unverified** from here: every request returned `403 {"code":"403","message":"Forbidden"}`, likely a geographic or WAF block. Kingfisher retrieved it on 2026-11-01 |
| Frequency | daily (registry) | third-party |
| Perú Compras (framework agreement POs) | `https://www.catalogos.perucompras.gob.pe/ConsultaOrdenesPub/`, OCID `ocds-luoe2u`, licence ODC-By | third-party (registry) |
| Action | run the 8c spike from a Peru or LatAm egress, or ask OECE for allowlisting | open |

### 1.5 Mexico (8c, lowest confidence)

| Item | Fact | Status |
|---|---|---|
| ComprasMX | `comprasmx.buengobierno.gob.mx` and `upcp-compranet.buengobierno.gob.mx` are an Angular single-page app; no public API documented | verified (no API found) |
| Federal Contrataciones Abiertas API | `api.datos.gob.mx/v1/contratacionesabiertas` and `contratacionesabiertas.hacienda.gob.mx` did not resolve | **unverified / likely retired** |
| National Digital Platform, system 6 (contracting) | `POST https://api.plataformadigitalnacional.org/s6/api/v1/search` with `{"page":0,"pageSize":N}`; OCDS-shaped records with awards, items, UNSPSC, suppliers; no auth | verified, total 1,060,983 |
| CompraNet historical | republished by civil-society projects (QuiénEsQuién.Wiki API) and state transparency bodies; licence "Términos de libre uso MX" (attribution, compatible with CC BY 4.0) for state publishers | third-party; QuiénEsQuién API did not respond |

---

## 2. Prior art: reuse versus write

| Project | Licence | Activity | Use in Polo |
|---|---|---|---|
| open-contracting/kingfisher-collect | BSD-3-Clause | pushed 2026-11-02 | **Reference, do not run.** Python/Scrapy does not fit the TypeScript worker. Port its per-country knowledge (URL patterns, paging, retry quirks) into our adapters and cite the spider file in each adapter header |
| open-contracting/ocds-merge (ocdsmerge) | BSD-3-Clause | 2026-11-02 | **Port the merge rules** (compiled release from releases, `id`-keyed arrays) to a small TS module; use the Python package only as a test oracle on recorded fixtures |
| open-contracting/ocdskit | BSD-3-Clause | 2026-11-02 | dev tooling for fixture prep (`compile`, `upgrade`); not a runtime dependency |
| open-contracting/lib-cove-ocds | BSD-3-Clause (GitHub shows NOASSERTION; LICENSE file reads BSD 3-Clause) | 2026-10-23 | optional offline schema validation of fixtures |
| open-contracting/cardinal-rs | MIT | 2026-11-02 | red-flag indicators. Candidate for the neutral review flags, evaluate in 8c |
| OCDS JSON schema 1.1 / 1.2 | standard | n/a | generate Zod types for the subset we read |
| afeld/sodapy | MIT | 2026-07-06 | Python; not needed. SoQL over `fetch` is a few lines |
| pgvector (+ pgvector-node, MIT) | PostgreSQL licence | active | **already in the repo** (`vector(1024)` on `ReferenceEmbedding`, `RequirementEmbedding` in `packages/db/prisma/schema.prisma`). Reuse for semantic tender search |
| pg_trgm | Postgres | n/a | **already enabled** (`extensions = [pgcrypto, pg_trgm, citext]`). Use for keyword radar and name matching |
| OpenSearch (opensearch-js, Apache-2.0) | Apache-2.0 | 2026-10-02 | **not now.** Postgres trigram plus pgvector covers MVP volume; revisit past about 20M line items |
| Country wrappers (`mercadopublico`, `chilecompra`, `compranet`, `pncp` searches) | mostly no licence; a few MIT with 0 stars | various | **do not reuse.** No licence means no rights; the MIT ones are unmaintained toys. DCCP-Hugo/MercadoPublicoOCDS (MIT, R, last push 2020) is official-adjacent documentation only |

Decision: **write thin TypeScript adapters, reuse the standard and the in-repo
search stack, port merge rules, keep Kingfisher as the documented reference.**

---

## 3. Architecture

### 3.1 Fit with the repo

- Worker: BullMQ queues in `apps/worker/src/queues/*`, started from
  `apps/worker/src/main.ts`; queue constants in
  `packages/shared/src/queue-config.integrations.ts`. Pattern to copy:
  `apps/worker/src/queues/competitor-research.ts` (Zod job data, `doNotRetry`,
  transaction plus `auditLog.create`, `limiter`).
- Repeat schedules: `repeat: { pattern }` / `repeat: { every }` with a fixed
  `jobId`, as in `apps/worker/src/queues/predictive-retrain.ts` and
  `task-kam-alerts.ts`.
- Outbound fetch: `createResearchFetch` (`apps/worker/src/lib/safe-research-fetch.ts`)
  over `createSafeFetch` / `assertUrlResolvesPublic`
  (`packages/shared/src/server/safe-outbound-fetch.ts`) and
  `assertPublicHttpUrl` (`packages/shared/src/utils/ssrf.ts`).
- Existing prior art inside Polo: `buildUsaSpendingCompetitorInsights` in
  `packages/shared/src/competitor-intel/index.ts` already turns public award data
  into cited `CompetitorInsight` rows. Public sector data feeds the same table.
- Existing landing table: `BidOpportunity` (`schema.prisma` line 1180) already has
  `source, externalId, buyer, country, region, status, dueDate,
  estimatedValueMicros, currencyCode, url, sourceAttribution, providerMetadata`
  and `@@unique([orgId, source, externalId])`. It is read by
  `apps/api/src/routes/account-signals.ts`. We extend it rather than add a parallel
  "opportunity" table.

### 3.2 Country adapter interface

New package folder `packages/shared/src/public-sector/` (pure, no DB):

```ts
export type PsCountry = 'CL' | 'CO' | 'BR' | 'PE' | 'MX';
export type PsStage = 'planned' | 'active' | 'awarded' | 'ordered' | 'paid' | 'cancelled';

export interface PsSourceRef {
  sourceKey: string;          // 'cl.mp.api', 'cl.mp.ocds', 'cl.da.lic', 'co.secop2.jbjy-vk9h'
  sourceUrl: string;          // canonical human link (ficha, urlproceso)
  apiUrl: string;             // the request that produced it, credential stripped
  publishedAt: Date | null;
  sourceUpdatedAt: Date | null;
  retrievedAt: Date;
  licence: string;            // 'CC0-1.0', 'CC-BY-SA-4.0', 'ChileCompra-API-terms'
  attribution: string;        // text shown in the UI and exports
  contentHash: string;        // sha256 of the raw payload
}

export interface PsAdapter {
  country: PsCountry;
  sourceKey: string;
  credentialName: string | null;          // e.g. 'MERCADOPUBLICO_API_TICKET'
  budget: { perDay?: number; perMinute?: number; quietHoursLocal?: [number, number] };
  plan(window: { from: Date; to: Date }, cursor: unknown): PsFetchUnit[];
  fetch(unit: PsFetchUnit, ctx: { fetch: FetchLike; secret?: string }): Promise<PsRawPage>;
  normalize(raw: PsRawPage): PsNormalized;  // entities, opportunities, lots, bids, awards, orders
  nextCursor(raw: PsRawPage, cursor: unknown): unknown | null;
}
```

Every adapter carries a header comment citing its official doc URL and the
Kingfisher spider it learned from. Adapters are pure so they run against recorded
fixtures with no network.

### 3.3 Ingestion pipeline

Queues (constants in a new `queue-config.public-sector.ts`):

| Queue | Job | Schedule | Concurrency / limiter |
|---|---|---|---|
| `ps-plan` | expands a source and window into fetch units | repeat, per source | 1 |
| `ps-fetch` | one HTTP unit to raw store | from plan | CL API: global limiter sized to 80% of 10,000/day; BR: 60/min; CO: 5 concurrent |
| `ps-normalize` | raw page to normalized upserts | after fetch | 4 |
| `ps-bulk-import` | stream a monthly zip (CL lic-da/oc-da) | monthly plus backfill | 1, Chile quiet hours |
| `ps-derive` | aggregates, benchmarks, flags, embeddings | after normalize batch | 2 |
| `ps-radar-match` | evaluate saved radars, write internal notifications | after derive | 2 |
| `ps-source-health` | schema drift and freshness checks | daily | 1 |

Default cadence (Chile): active tenders `estado=activas` every 2 h in business
hours; yesterday's tenders and POs by `fecha` nightly 22:00 to 07:00 America/Santiago;
OCDS month lists nightly for the current and previous month; bulk zips monthly
after `Last-Modified` changes; erroneous-PO list and parity files weekly.

Backoff: exponential from 10 s, 5 attempts. Chile `Codigo 203` (bad ticket) and
quota exhaustion set `doNotRetry` and pause the source with a `source.paused`
audit event. HTTP 429 honours `Retry-After`. A per-source circuit breaker opens
after 5 consecutive failures.

Quota accounting: a Redis counter per credential per Chile calendar day, checked
before each Chile API call. The daily quota is shared by every environment using
the same ticket, so staging must use a different ticket or fixtures only.

### 3.4 Raw and normalized stores

- **Raw**: every fetched payload is stored byte-for-byte in object storage
  (same storage layer as `apps/worker/src/lib/storage-read.ts`), keyed
  `ps-raw/{country}/{sourceKey}/{yyyy}/{mm}/{dd}/{contentHash}.{json|xml|csv.zip}`,
  with a `PsRawFetch` row as the index. Raw is never mutated. Credentials are
  stripped from the stored request URL.
- **Normalized**: Postgres tables in section 4. Each normalized row points to the
  raw rows that produced it.
- Idempotency: natural keys per source (`orgId, sourceKey, externalId`); upserts
  compare `contentHash` and skip unchanged rows; a changed hash writes a
  `PsRecordVersion` diff so "last update" and change history are real.

### 3.5 Traceability fields (on every normalized row)

`sourceKey, externalId, sourceUrl, apiUrl, publishedAt, sourceUpdatedAt,
retrievedAt, licence, attribution, rawFetchIds[], contentHash, confidenceBps,
stage`. The UI and every agent answer must render source link, publication date,
last update and confidence, and label the stage (planned, active, awarded,
ordered or paid).

### 3.6 Confidence model

`confidenceBps` (0 to 10,000), matching the existing `CompetitorInsight.confidenceBps`
convention. Computed, never LLM-asserted:

- source tier: official API or bulk 1.0; official OCDS 0.95; third-party
  republisher 0.7;
- completeness: share of required fields present for the object type;
- freshness decay per stage (active tender older than 24 h loses confidence);
- cross-source agreement (API vs bulk vs OCDS amounts) adds or subtracts;
- flags: `excludedFromOfficial`, currency mismatch, amount outlier above p99 for the
  UNSPSC class.

Benchmarks also carry `comparableCount`; below 5 comparables, show "insufficient
data", not a number.

### 3.7 Tenancy

All tables are org-scoped (`orgId` + `@@index([orgId, ...])`), matching
`schema.prisma`'s header rule and `packages/db/src/middleware/tenant-scope-guard.ts`.
Public data is duplicated per enabled org. This costs storage but keeps tenant
export (`tenant-export` queue), erasure (`apps/api/src/routes/erasure.ts`) and the
guard working unchanged. A shared catalog is a later optimisation (open question 3).

### 3.8 Credentials

- Chile ticket: credential NAME `MERCADOPUBLICO_API_TICKET`. Stored per org in
  `integration_configs` through the data-provider pattern
  (`apps/api/src/lib/data-provider-credentials.ts`: add `'mercadopublico'` to
  `DATA_PROVIDERS` with a tester that calls `BuscarComprador` once). Encrypted with
  `encryptSecret` from `@bidstack/shared/server-crypto`.
- Colombia optional: `DATOS_GOV_CO_APP_TOKEN` (same pattern, provider `'socrata-co'`).
- Local development: values come from the Keychain via
  `99_Meta/keys/get-key.sh MERCADOPUBLICO_API_TICKET`. The value is never
  committed; `.env.example` lists the NAME only, with an empty value.
- Ticket governance: the ticket belongs to a named natural person (terms clause 3).
  Record `ticketOwnerUserId`, `issuedAt`, `lastVerifiedAt` and the accepted terms
  version on the config row. If the owner leaves, the ticket must be reissued by a
  new person; it cannot be transferred.

### 3.9 RBAC (add to `packages/shared/src/types/permissions.ts` and `packages/db/src/seed.ts`)

| Permission | Grants |
|---|---|
| `public-sector:read` | radar, entity profiles, opportunity detail, benchmarks |
| `public-sector:write` | saved radars, watchlists, notes, links to Company / Opportunity / CompetitorProfile |
| `public-sector:admin` | source config, credentials, backfills, pause / resume |
| `public-sector:pricing` | rate and pricing benchmarks (commercially sensitive) |

Bid/no-bid scoring keeps the existing `bid-scores:read` / `bid-scores:write`.
Routes declare `config: { permission }` (enforced by `apps/api/src/plugins/rbac.ts`).
Agent and API-key access is read-only by default.

### 3.10 Audit events (`AuditLog.action`)

`ps.source.configured`, `ps.source.credential_set`, `ps.source.paused`,
`ps.source.resumed`, `ps.backfill.requested`, `ps.ingest.completed` (counts only),
`ps.schema.drift_detected`, `ps.radar.created`, `ps.radar.matched`,
`ps.opportunity.linked`, `ps.flag.reviewed`, `ps.brief.generated`,
`ps.qualification.recommended`, `ps.qualification.decided` (human, with userId),
`ps.export.created` (with licence and attribution). Ingestion events use
`userId: null` like `competitor.research.complete`.

### 3.11 Change monitoring

`ps-source-health` records, per source: last success, record counts versus 7-day
median, JSON key set and CSV header hash versus the stored baseline, and HTTP
status mix. Drift writes `ps.schema.drift_detected` and pauses normalize for that
source (raw keeps flowing). It also re-reads the ChileCompra terms page weekly and
alerts if its hash changes.

---

## 4. Data model (Prisma, `packages/db/prisma/schema.prisma`)

Conventions copied from the schema: `@db.Uuid` ids, `orgId` with
`onDelete: Cascade`, snake_case `@map`, `@db.Timestamptz(6)`, money as `BigInt`
micros (`estimatedValueMicros`), `confidenceBps Int`, `deletedAt` soft delete,
explicit index names. Embeddings use `Unsupported("vector(1024)")` plus a raw-SQL
HNSW index, as `ReferenceEmbedding` does. One migration per phase.

| Model | Purpose | Key fields |
|---|---|---|
| `PsSource` | per-org source config and cursor | `country, sourceKey, enabled, cursor Json, lastSuccessAt, pausedReason, credentialConfigId` |
| `PsRawFetch` | raw index | `sourceKey, requestUrlRedacted, httpStatus, storageKey, contentHash, bytes, retrievedAt` |
| `PsPublicEntity` | buyer (organismo, entidad, órgão) | `country, externalId, taxId (RUT/NIT/CNPJ of the institution), name, normalizedName, sector, region, comuna, parentExternalId, companyId? -> Company` |
| `BidOpportunity` (extend) | procurement opportunity | add `stage, procurementMethod, isDirectAward, closesAt, publishedAt, sourceUpdatedAt, unspscCodes String[], publicEntityId?, ocid?, confidenceBps, sourceKey, rawFetchIds String[], contentHash, opportunityId? -> Opportunity` |
| `PsLot` | line items / lots | `bidOpportunityId, lineNo, unspsc, description, quantity, unit, estimatedValueMicros` |
| `PsSupplier` | supplier or competitor | `country, taxId, name, normalizedName, isNaturalPerson, competitorProfileId? -> CompetitorProfile, companyId?` |
| `PsBid` | offer received | `bidOpportunityId, lotId?, supplierId, offeredAmountMicros, currencyCode, selected Boolean, submittedAt` |
| `PsAward` | award | `bidOpportunityId, lotId?, supplierId, amountMicros, currencyCode, awardedAt` |
| `PsPurchaseOrder` | ordered / paid | `country, externalId, publicEntityId, supplierId, bidOpportunityId?, amountMicros, currencyCode, status, statusCode, issuedAt, excludedFromOfficial Boolean, exclusionReason` |
| `PsProcurementPlanItem` | annual plan (planned stage) | `publicEntityId, year, description, unspsc, estimatedValueMicros, plannedQuarter` |
| `PsDocument` | tender annex metadata | `bidOpportunityId, title, kind (technical/economic/bases/other), sourceUrl, fetchedStorageKey?, sha256, fetchStatus` |
| `PsCommercialBenchmark` | pricing intelligence | `role, seniority, country, region, currencyCode, periodStart, periodEnd, p25/p50/p75 Micros, comparableCount, inflationIndex, inflationBaseDate, method, confidenceBps, evidenceIds String[]` |
| `PsReviewFlag` | neutral review flags | `targetType, targetId, kind ('direct_award', 'single_bidder', 'amount_outlier', 'currency_mismatch'), status ('open','reviewed','dismissed'), reviewedByUserId?, note` |
| `PsRadar` | saved radar | `name, ownerUserId, filters Json (keywords, entities, regions, unspsc, stage, closesWithinDays, minValue, maxValue, competitors), notify ('none','in_app','digest_draft')` |
| `PsRecordVersion` | change history | `targetType, targetId, contentHashBefore, contentHashAfter, diff Json, observedAt` |
| `PsOpportunityEmbedding` | semantic search | `bidOpportunityId @unique, model, dim, vector Unsupported("vector(1024)"), contentHash` |

CRM actions are not a new model: they are `Task`, `Activity`, `Opportunity` and
`CompetitorInsight` rows linked from `BidOpportunity.opportunityId` or the
`PsSupplier.competitorProfileId`, so the existing CRM, audit and export paths apply.
Competitor awards and bids also emit `CompetitorInsight` rows (category `win_loss`
or `pricing`, `provider: 'public-sector:{sourceKey}'`, `sourceUrl` = ficha URL).

Search: a GIN trigram index on `BidOpportunity (title || ' ' || buyer)` in raw SQL,
following the `opps_search_idx` note at `schema.prisma` line 595.

---

## 5. UI (apps/web)

Follows `docs/DESIGN.md`: one accent `#006b4f`, neutrals carry the page, slide-over
sheets for detail, table state in the URL (`nuqs`), `tabular-nums` for money,
`font-medium` headings. Uses the TUFFUI-style components planned in slices 1 and 3
(data table, filter bar, sheet, stat tile, confidence chip); this slice does not
build them.

Routes in a new `apps/web/src/routes/PublicSectorRoutes.tsx` (function returning
`<Route>` elements, same pattern as `BidRoutes.tsx`), lazy pages in `lazyPages.tsx`,
wrapped in `RequireAuth`:

| Route | Page | Content |
|---|---|---|
| `/public-sector` | Radar | saved radars on the left, results table: title, entity, region, stage chip, closes in, value, competitors seen, documents count, confidence chip, source link |
| `/public-sector?open=<id>` | Opportunity sheet | timeline planned / active / awarded / ordered, lots, bids, award, documents, review flags, "Link to opportunity", "Generate pre-sales brief", attribution footer |
| `/public-sector/entities/:id` | Entity profile | spend by UNSPSC category, top suppliers, average contract size, plan items, open tenders |
| `/public-sector/competitors/:id` | Competitor benchmark | awards, bids, win rate (shown only when bids data is complete for the window), staffing and rates from annexes |
| `/public-sector/pricing` | Pricing benchmark | filters role / seniority / country / region / currency / period; quartiles with comparable count and confidence; the public-vs-private gap panel labelled "Hypothesis under test" |
| `/public-sector/ask` | Natural language | answer plus result table, every row with source link, published, last update, confidence, stage |
| Settings, Data sources | existing card `apps/web/src/components/settings/DataSourceCredentialsCard.tsx` (hook `useDataProviders.ts`) | add Mercado Público ticket entry and source health |

Every data screen shows the source attribution line, for example:
"Fuente: Dirección ChileCompra (Mercado Público). Datos procesados por Polo." When
a view shows unmodified API data, the line reads "Fuente de los datos: Dirección
ChileCompra."

Copy rules: review flags say "Needs review: direct award" or "Single bidder", never
"suspicious", "irregular" or "fraud". The bid/no-bid panel says "Recommendation for
the bid committee"; the decision control belongs to a human and is recorded as
`ps.qualification.decided`.

---

## 6. Security and compliance

### 6.1 Hard safeguards (enforced in code and tests)

- No automatic bid submission, no proposal sending, no contacting officials. No
  adapter, tool or route may POST to a procurement platform. CI test: adapter
  modules contain no non-GET method except the documented PDN `search` POST.
- No final decisions: qualification writes `recommendation` only; `decision` needs
  a human session (`requireHumanActor`).
- Outreach and alerts: drafts or opt-in internal notifications only. Radar
  `notify` cannot target external addresses.
- No legally binding statements without human review: briefs carry
  "Draft for internal review" and cannot be exported without a reviewer.

### 6.2 Fetch safety

All outbound calls, including tender annex downloads whose URLs come from
untrusted data, go through `createResearchFetch` (SSRF and DNS-rebinding guard),
with a per-source host allowlist on top (`api.mercadopublico.cl`,
`*.blob.core.windows.net` for ChileCompra containers, `www.datos.gov.co`,
`dadosabertos.compras.gov.br`, `api.plataformadigitalnacional.org`, `contratacionesabiertas.oece.gob.pe`).
Annex files: size cap, MIME sniffing, text extraction in the existing sandbox
(`apps/worker/src/lib/extract-text-sandbox.ts`). Annex text is untrusted and goes
through `buildAgentUserMessage` before any LLM call, as in `competitor-research.ts`.

### 6.3 Personal data

- Natural-person suppliers exist in every source (Chile RUT of individuals,
  Colombia cédula). Store `isNaturalPerson`; hash the tax ID (`taxIdHash`) for
  natural persons and keep only the display name. Use the existing PII encryption
  (`packages/db/src/middleware/pii-encryption.ts`) for any retained personal field.
- Colombia: drop at ingestion `n_mero_de_cuenta, nombre_del_banco, tipo_de_cuenta,
  identificaci_n_representante_legal, g_nero_representante_legal`, and the
  supervisor, ordenador del gasto and ordenador de pago IDs. Raw store keeps the
  file; the raw bucket is restricted to `public-sector:admin` and has a shorter
  retention.
- Public officials' names in documents are not extracted into structured fields.
- Fixtures: recorded from real responses, then scrubbed by a script that replaces
  natural-person names, RUT/cédula/CPF, emails and phones with stable fakes. A test
  fails if a fixture matches the RUT, CPF or email regex for a non-institution.

### 6.4 Legal angles (for review by Mantu legal, not legal advice)

- Chile: Ley 19.628 and Ley 21.719 (new data protection law; entry into force
  date not re-verified in this slice, confirm with legal).
  Public procurement data is public by law, but reuse must respect purpose; keep
  natural-person data minimal.
- Brazil: LGPD. Supplier CPFs and individual names are personal data even when
  published by the State; the legal basis is legitimate interest, and minimisation
  applies.
- Colombia: Ley 1581 de 2012. Peru: Ley 29733. Mexico: LFPDPPP.
- EU: Polo runs for an EU group, so GDPR applies to processing; record this source
  in the ROPA and DPIA (`docs/compliance/`).
- Licences: Chile OCDS CC0; Chile API terms require ChileCompra attribution for
  unmodified data; Colombia CC BY-SA 4.0 (share-alike on any public redistribution);
  Peru Compras ODC-By; Mexican state publishers "libre uso MX". Exports carry the
  licence and attribution of every source in them.

### 6.5 Retention

Raw payloads: 24 months, then delete, except monthly bulk archives (kept, since
they are reproducible public files). Normalized: while the module is enabled.
Natural-person supplier rows: 36 months after last activity unless linked to a CRM
record. Tenant erasure removes everything through the cascade on `orgId`.

---

## 7. Agent workflows

Agents run as worker jobs (`apps/worker/src/crew/engine.ts`, `apps/worker/src/agent/`)
and are exposed as read-only MCP tools in `apps/mcp-server/src/tools/index.ts`
(dotted names plus `crm_*` aliases, the existing convention). Every tool returns
rows with `sourceUrl, publishedAt, sourceUpdatedAt, confidenceBps, stage`;
cite-or-omit is enforced with `enforceCitations` from
`packages/shared/src/competitor-intel/index.ts`.

| Agent | Trigger | Reads | Writes | MCP tool |
|---|---|---|---|---|
| Tender Monitor | `ps-radar-match` | radars, new opportunities | in-app notification, `ps.radar.matched` | `public_sector.radar.list` |
| Account Research | user on entity page | entity, plan items, POs, awards | draft account note | `public_sector.entity.profile` |
| Competitor Benchmark | user or weekly | bids, awards per supplier | `CompetitorInsight` rows | `public_sector.competitor.benchmark` |
| Qualification | user on opportunity sheet | opportunity, fit, competitors, flags | `BidScore` with `aiSuggested=true`, recommendation only | `public_sector.qualification.recommend` |
| Pricing Benchmark | user on pricing page | annex rates, awards, PO lines, inflation index | `PsCommercialBenchmark` | `public_sector.pricing.benchmark` |
| Pre-sales Brief | user | all of the above | draft `Document` marked for review | `public_sector.brief.draft` |
| Natural-language query | `/public-sector/ask`, MCP | text-to-filter over a fixed query schema (no free SQL) | none | `public_sector.search` |

The natural-language agent translates a question into the same typed filter the
radar uses, then runs it; it never writes SQL. Answers always split results by
stage: planned, active, awarded, ordered or paid.

---

## 8. Phased delivery with fail-first tests

Each phase lands red tests first, then code, behind the `publicSector` feature
flag. CI gate list must match the repo's CI exactly (lesson from 2026-11-06).

**8b.0 Fixtures and contracts (Chile).** Record real responses (OCDS list and
tender, one `licitaciones.json` day, one `ordenesdecompra.json` day, first 200 rows
of `lic-da` and `oc-da`, `hist_OC_erroneas.csv` head), scrub PII, commit under
`packages/shared/src/public-sector/__fixtures__/cl/`.
Tests: fixture scrubber rejects an unscrubbed RUT; Zod parsers accept every
fixture; parser rejects `{"Codigo":203}` as `TicketInvalid`.

**8b.1 Adapter and raw store.** Tests: credential never appears in
`requestUrlRedacted`; quota guard refuses call 8,001 of the day; 203 sets
`doNotRetry` and pauses the source; annex URL to `169.254.169.254` is blocked.

**8b.2 Normalize and idempotent upsert.** Tests: running the same fixture twice
yields zero new rows and zero `PsRecordVersion`; a changed amount yields one
version; status code 8 maps to stage `awarded`; Latin-1 CSV decodes
`EXÁMENES` correctly; an erroneous PO is stored with `excludedFromOfficial=true`
and is excluded from official totals but present in raw totals.

**8b.3 Radar and opportunity sheet.** Tests: route without
`public-sector:read` returns 403; radar filter by UNSPSC, region and closing window;
every row renders source link, published, last update, confidence; attribution
line present on every data view (snapshot test pins the text).

**8b.4 Entity profile and competitor view.** Tests: win rate hidden when bid data is
incomplete; direct award produces a `PsReviewFlag` whose copy contains none of the
banned accusation words (pinned list test).

**8b.5 Qualification and brief.** Tests: API-key actor cannot record a decision;
recommendation never sets `decision`; brief export blocked without reviewer.

**8b.6 MCP tools.** Tests: tools are read-only (no `:write` scope accepted); every
result row has `sourceUrl`; uncited rows dropped.

**8c.1 Colombia.** Tests: PII columns absent after normalize; share-alike licence
carried into exports; 429 honours `Retry-After`.

**8c.2 Brazil.** Tests: paging stops at `paginasRestantes = 0`; limiter holds 60/min;
annual plan maps to stage `planned`.

**8c.3 Peru.** Spike first from a LatAm egress; tests written only after a real
fixture is recorded.

**8c.4 Mexico.** PDN S6 adapter; tests on POST paging and UNSPSC mapping. ComprasMX
deferred until an official API exists.

**8c.5 Pricing benchmark.** Tests: fewer than 5 comparables shows "insufficient
data"; inflation adjustment uses the stated index and base date; the public-vs-
private gap is stored as a hypothesis with its test result, never as a constant.

---

## 9. Open questions

1. Who owns the Mercado Público ticket? It is personal (RUT plus Clave Única) and
   non-transferable. Tony, or a Chilean colleague with Clave Única?
2. Can one ticket legally serve a multi-tenant SaaS? The terms do not say. Until
   answered, one ticket per org.
3. Shared public catalog versus per-org copies once more than one org enables the
   module.
4. Peru OECE blocks requests from this network. Do we have a LatAm egress?
5. Mexico federal: is there a current official ComprasMX data API, or do we rely
   on PDN S6 only?
6. Brazil licence for Compras.gov.br data is not stated in the OpenAPI document;
   confirm on the gov.br open-data page.
7. Pricing from annexes: which document types are allowed to be parsed and
   retained (economic annexes may contain rate cards marked confidential by the
   bidder)?
8. Inflation index per country (Chile UF/IPC, Colombia IPC, Brazil IPCA, Peru IPC,
   Mexico INPC): which official series and refresh cadence?
