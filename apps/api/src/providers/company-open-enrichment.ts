import type { SourceAttribution } from '@bidstack/shared';

import {
  asUrl,
  attribution,
  commonsFileUrl,
  fetchJson,
  isRecord,
  normalizeDomain,
  normalizeName,
} from './company-open-enrichment.utils.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface OpenCompanyInput {
  name: string;
  domain?: string | null;
  website?: string | null;
  now?: Date;
  fetchImpl?: FetchLike;
}

export interface OpenCompanyProfile {
  legalName: string | null;
  tradeName: string | null;
  domain: string | null;
  website: string | null;
  description: string | null;
  logoUrl: string | null;
  logoSource: 'wikimedia' | 'favicon' | null;
  imageUrl: string | null;
  employeeCount: number | null;
  incorporationDate: string | null;
  industryLabels: string[];
  confidenceBps: number;
  sourceAttribution: SourceAttribution[];
  providerMetadata: Record<string, unknown>;
}

interface WikidataSearchResult {
  id?: string;
  label?: string;
  description?: string;
  concepturi?: string;
}

interface WikidataEntity {
  id?: string;
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<string, unknown[]>;
  sitelinks?: Record<string, { title?: string; url?: string }>;
}

interface WikipediaSummary {
  extract?: string;
  description?: string;
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
  content_urls?: { desktop?: { page?: string } };
}

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIPEDIA_SUMMARY_API = 'https://en.wikipedia.org/api/rest_v1/page/summary';

const PROPERTY = {
  officialWebsite: 'P856',
  logoImage: 'P154',
  image: 'P18',
  inception: 'P571',
  employeeCount: 'P1128',
  industry: 'P452',
} as const;

export async function fetchOpenCompanyProfile({
  name,
  domain,
  website,
  now = new Date(),
  fetchImpl = fetch,
}: OpenCompanyInput): Promise<OpenCompanyProfile | null> {
  const inputDomain = normalizeDomain(domain ?? website);
  const search = await searchWikidata(name, fetchImpl);
  const candidates = await Promise.all(
    search.slice(0, 5).map(async (result) => {
      if (!result.id) return null;
      const entity = await getWikidataEntity(result.id, fetchImpl);
      if (!entity) return null;
      return {
        result,
        entity,
        score: scoreEntity({ name, inputDomain, result, entity }),
      };
    }),
  );
  const best = candidates
    .filter((item): item is NonNullable<(typeof candidates)[number]> => item !== null)
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < 0.62) return null;

  const entity = best.entity;
  const label = entity.labels?.en?.value ?? best.result.label ?? name;
  const description = entity.descriptions?.en?.value ?? best.result.description ?? null;
  const officialWebsite = claimString(entity, PROPERTY.officialWebsite);
  const resolvedWebsite = asUrl(officialWebsite ?? website ?? domain ?? null);
  const resolvedDomain = normalizeDomain(resolvedWebsite ?? inputDomain);
  const logoFile = claimString(entity, PROPERTY.logoImage);
  const imageFile = claimString(entity, PROPERTY.image);
  const logoUrl = logoFile ? commonsFileUrl(logoFile) : null;
  const wikimediaImageUrl = imageFile ? commonsFileUrl(imageFile) : null;
  const employeeCount = claimQuantity(entity, PROPERTY.employeeCount);
  const incorporationDate = claimDate(entity, PROPERTY.inception);
  const wikipediaTitle = entity.sitelinks?.enwiki?.title ?? null;
  const summary = wikipediaTitle ? await fetchWikipediaSummary(wikipediaTitle, fetchImpl) : null;
  const imageUrl =
    wikimediaImageUrl ?? summary?.thumbnail?.source ?? summary?.originalimage?.source ?? null;
  const pageUrl = summary?.content_urls?.desktop?.page ?? entity.sitelinks?.enwiki?.url ?? null;
  const industryLabels = claimEntityIds(entity, PROPERTY.industry);
  const confidence = Math.min(0.94, Math.max(0.68, best.score));

  return {
    legalName: label,
    tradeName: label,
    domain: resolvedDomain,
    website: resolvedWebsite,
    description: summary?.extract ?? description,
    logoUrl,
    logoSource: logoUrl ? 'wikimedia' : null,
    imageUrl,
    employeeCount,
    incorporationDate,
    industryLabels: [
      ...(description ? [description] : []),
      ...industryLabels.map((id) => `Wikidata industry ${id}`),
    ].slice(0, 6),
    confidenceBps: Math.round(confidence * 10_000),
    sourceAttribution: [
      attribution({
        source: 'wikidata',
        label: 'Wikidata entity profile',
        sourceUrl:
          best.result.concepturi ?? `https://www.wikidata.org/wiki/${entity.id ?? best.result.id}`,
        fetchedAt: now,
        confidence,
        providerMetadata: {
          wikidataId: entity.id ?? best.result.id ?? null,
          matchedLabel: label,
          matchScore: best.score,
          inputDomain,
        },
      }),
      ...(pageUrl
        ? [
            attribution({
              source: 'wikipedia',
              label: 'Wikipedia summary and media',
              sourceUrl: pageUrl,
              fetchedAt: now,
              confidence: Math.max(0.6, confidence - 0.08),
              providerMetadata: { wikipediaTitle },
            }),
          ]
        : []),
    ],
    providerMetadata: {
      wikidataId: entity.id,
      wikidataLabel: label,
      wikidataDescription: description,
      wikipediaTitle,
      wikipediaUrl: pageUrl,
      wikipediaExtract: summary?.extract ?? null,
      logoFile,
      imageFile,
      companyImageUrl: imageUrl,
      openDataProvider: 'wikidata_wikimedia',
    },
  };
}

export function faviconProfile({
  name,
  domain,
  website,
  now = new Date(),
}: {
  name: string;
  domain: string | null;
  website: string | null;
  now?: Date;
}): Pick<
  OpenCompanyProfile,
  'logoUrl' | 'logoSource' | 'sourceAttribution' | 'providerMetadata' | 'domain' | 'website'
> {
  const resolvedDomain = normalizeDomain(domain ?? website);
  const resolvedWebsite = asUrl(website ?? resolvedDomain);
  const logoUrl = resolvedDomain ? `https://${resolvedDomain}/favicon.ico` : null;
  return {
    domain: resolvedDomain,
    website: resolvedWebsite,
    logoUrl,
    logoSource: logoUrl ? 'favicon' : null,
    sourceAttribution: logoUrl
      ? [
          attribution({
            source: 'favicon',
            label: `${name} website favicon fallback`,
            sourceUrl: resolvedWebsite ?? `https://${resolvedDomain}/`,
            fetchedAt: now,
            confidence: 0.58,
            providerMetadata: { domain: resolvedDomain },
          }),
        ]
      : [],
    providerMetadata: { faviconUrl: logoUrl },
  };
}

async function searchWikidata(name: string, fetchImpl: FetchLike): Promise<WikidataSearchResult[]> {
  const url = new URL(WIKIDATA_API);
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('search', name);
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');
  url.searchParams.set('origin', '*');
  const json = await fetchJson<{ search?: WikidataSearchResult[] }>(
    url,
    fetchImpl,
    'Wikidata entity search',
  );
  return json.search ?? [];
}

async function getWikidataEntity(id: string, fetchImpl: FetchLike): Promise<WikidataEntity | null> {
  const url = new URL(WIKIDATA_API);
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('ids', id);
  url.searchParams.set('props', 'claims|labels|descriptions|sitelinks');
  url.searchParams.set('languages', 'en');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const json = await fetchJson<{ entities?: Record<string, WikidataEntity> }>(
    url,
    fetchImpl,
    'Wikidata entity details',
  );
  return json.entities?.[id] ?? null;
}

async function fetchWikipediaSummary(
  title: string,
  fetchImpl: FetchLike,
): Promise<WikipediaSummary | null> {
  try {
    return await fetchJson<WikipediaSummary>(
      `${WIKIPEDIA_SUMMARY_API}/${encodeURIComponent(title)}`,
      fetchImpl,
      'Wikipedia page summary',
    );
  } catch {
    return null;
  }
}

function scoreEntity({
  name,
  inputDomain,
  result,
  entity,
}: {
  name: string;
  inputDomain: string | null;
  result: WikidataSearchResult;
  entity: WikidataEntity;
}): number {
  const label = (entity.labels?.en?.value ?? result.label ?? '').toLowerCase();
  const normalizedName = normalizeName(name);
  const normalizedLabel = normalizeName(label);
  const description = (entity.descriptions?.en?.value ?? result.description ?? '').toLowerCase();
  const officialDomain = normalizeDomain(claimString(entity, PROPERTY.officialWebsite));
  let score = 0.35;
  if (normalizedLabel === normalizedName) score += 0.28;
  else if (normalizedLabel.includes(normalizedName) || normalizedName.includes(normalizedLabel)) {
    score += 0.1;
  }
  if (inputDomain && officialDomain && inputDomain === officialDomain) score += 0.34;
  if (entity.sitelinks?.enwiki?.title) score += 0.08;
  if (description.match(/\b(company|corporation|business|enterprise|bank|software|technology)\b/)) {
    score += 0.08;
  }
  return Math.min(score, 1);
}

function claimString(entity: WikidataEntity, property: string): string | null {
  const value = claimValue(entity, property);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function claimQuantity(entity: WikidataEntity, property: string): number | null {
  const value = claimValue(entity, property);
  if (!isRecord(value) || typeof value.amount !== 'string') return null;
  const parsed = Number(value.amount);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function claimDate(entity: WikidataEntity, property: string): string | null {
  const value = claimValue(entity, property);
  if (!isRecord(value) || typeof value.time !== 'string') return null;
  const match = value.time.match(/^\+?(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const candidate = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || candidate !== date.toISOString().slice(0, 10)
    ? null
    : candidate;
}

function claimEntityIds(entity: WikidataEntity, property: string): string[] {
  const claims = entity.claims?.[property] ?? [];
  return claims
    .map((claim) => {
      if (!isRecord(claim)) return null;
      const mainsnak = claim.mainsnak;
      if (!isRecord(mainsnak)) return null;
      const datavalue = mainsnak.datavalue;
      if (!isRecord(datavalue)) return null;
      const value = datavalue.value;
      if (!isRecord(value) || typeof value.id !== 'string') return null;
      return value.id;
    })
    .filter((id): id is string => id !== null);
}

function claimValue(entity: WikidataEntity, property: string): unknown {
  const claim = entity.claims?.[property]?.[0];
  if (!isRecord(claim)) return null;
  const mainsnak = claim.mainsnak;
  if (!isRecord(mainsnak)) return null;
  const datavalue = mainsnak.datavalue;
  if (!isRecord(datavalue)) return null;
  return datavalue.value ?? null;
}

// commonsFileUrl, fetchJson, attribution, asUrl, normalizeDomain, normalizeName,
// and isRecord are imported from ./company-open-enrichment.utils.js
