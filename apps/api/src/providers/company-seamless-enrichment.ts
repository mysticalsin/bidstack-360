// Seamless.AI company enrichment — a paid EXTERNAL data source (same trust class
// as Apollo). Returns the shared OpenCompanyProfile shape so it drops into the
// enrichment service as a higher-priority source than the keyless Wikidata path.
//
// Auth: `Token: <SEAMLESS_API_KEY>` header (per Seamless OpenAPI). The key is read
// from env ONLY — never hard-coded or logged. No key → null (the service falls
// back to open enrichment). Fail-open on any error.
//
// Endpoint: POST {base}/search/companies → { data: [ {company...} ], success }.
// Rich fields (employees, revenue, technologies, funding, news) are preserved in
// providerMetadata.seamless for the account view; core fields map to the profile.

import type { SourceAttribution } from '@bidstack/shared';

import type { OpenCompanyProfile } from './company-open-enrichment.js';
import { attribution } from './company-open-enrichment.utils.js';

const DEFAULT_BASE_URL = 'https://api.seamless.ai/api/client/v1';
const TIMEOUT_MS = 15_000;
const MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_MCP_TOOL = 'search_companies';

interface SeamlessCompany {
  name?: string;
  domain?: string;
  website?: string;
  websiteUrl?: string;
  website_url?: string;
  description?: string;
  country?: string;
  employeeCount?: number;
  staffCountRange?: string;
  revenueRange?: string;
  annualRevenue?: number;
  industries?: string[];
  technologies?: string[];
  foundedOn?: string | number;
  fundingTotal?: number;
  newsAndEvents?: unknown;
  sicCode?: string;
  companyType?: string;
  stockTicker?: string;
  linkedInId?: string;
  companyLIURL?: string;
  searchResultId?: string;
}

function toIso(v: string | number | undefined): string | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(typeof v === 'number' ? String(v) : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rowsFromUnknown(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(record).filter((row) => Object.keys(row).length > 0);
  const root = record(value);
  for (const key of ['data', 'companies', 'results', 'items', 'records']) {
    const rows = rowsFromUnknown(root[key]);
    if (rows.length > 0) return rows;
  }
  for (const key of ['company', 'organization', 'account']) {
    const row = record(root[key]);
    if (Object.keys(row).length > 0) return [row];
  }
  return Object.keys(root).length > 0 ? [root] : [];
}

function firstString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === 'string') return [item];
        const itemRecord = record(item);
        return [
          firstString(itemRecord, ['name', 'label', 'title', 'technology', 'vendor']) ?? '',
        ];
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function seamlessCompanyFromRecord(row: Record<string, unknown>): SeamlessCompany {
  return {
    searchResultId: firstString(row, ['searchResultId', 'id', 'companyId', 'company_id']),
    name: firstString(row, ['name', 'companyName', 'company_name', 'organization_name']),
    domain: firstString(row, ['domain', 'companyDomain', 'company_domain', 'primary_domain']),
    website:
      firstString(row, ['website', 'websiteUrl', 'website_url', 'url']) ??
      firstString(row, ['companyLIURL', 'linkedInUrl']),
    description: firstString(row, ['description', 'short_description', 'about']),
    country: firstString(row, ['country', 'countryCode', 'country_code']),
    employeeCount: firstNumber(row, ['employeeCount', 'employee_count', 'employees']),
    staffCountRange: firstString(row, ['staffCountRange', 'employeeRange', 'employee_range']),
    revenueRange: firstString(row, ['revenueRange', 'revenue_range']),
    annualRevenue: firstNumber(row, ['annualRevenue', 'annual_revenue', 'revenue']),
    industries: uniqueStrings([
      ...stringList(row.industries),
      ...stringList(row.industry),
      ...stringList(row.industryLabels),
    ]),
    technologies: uniqueStrings([
      ...stringList(row.technologies),
      ...stringList(row.technology),
      ...stringList(row.techStack),
      ...stringList(row.tech_stack),
    ]),
    foundedOn: firstString(row, ['foundedOn', 'founded_on', 'foundedYear', 'founded_year']),
    fundingTotal: firstNumber(row, ['fundingTotal', 'funding_total', 'totalFunding']),
    newsAndEvents: row.newsAndEvents ?? row.news ?? row.latest_news,
    sicCode: firstString(row, ['sicCode', 'sic_code']),
    companyType: firstString(row, ['companyType', 'company_type']),
    stockTicker: firstString(row, ['stockTicker', 'stock_ticker', 'ticker']),
    linkedInId: firstString(row, ['linkedInId', 'linkedin_id']),
    companyLIURL: firstString(row, ['companyLIURL', 'linkedin_url', 'linkedInUrl']),
  };
}

function pickSeamlessCompany(result: unknown, domain?: string | null, name?: string): SeamlessCompany | null {
  const rows = rowsFromUnknown(result);
  if (rows.length === 0) return null;
  const first = rows[0];
  if (!first) return null;
  const normalizedDomain = domain?.toLowerCase().replace(/^www\./, '') ?? null;
  const normalizedName = name?.trim().toLowerCase() ?? null;
  const match =
    rows.find((row) => {
      const rowDomain = firstString(row, ['domain', 'companyDomain', 'primary_domain']);
      return normalizedDomain && rowDomain?.toLowerCase().replace(/^www\./, '') === normalizedDomain;
    }) ??
    rows.find((row) => {
      const rowName = firstString(row, ['name', 'companyName', 'company_name']);
      return normalizedName && rowName?.toLowerCase() === normalizedName;
    }) ??
    first;
  return seamlessCompanyFromRecord(match);
}

function seamlessProfile({
  company,
  fallbackName,
  fallbackDomain,
  fallbackWebsite,
  now,
  transport,
  sourceTool,
}: {
  company: SeamlessCompany;
  fallbackName: string;
  fallbackDomain?: string | null;
  fallbackWebsite?: string | null;
  now: Date;
  transport: 'mcp_streamable_http' | 'rest_api';
  sourceTool: string;
}): OpenCompanyProfile {
  const resolvedDomain = company.domain ?? fallbackDomain ?? null;
  const companyWebsite = company.website ?? company.websiteUrl ?? company.website_url ?? null;
  const resolvedWebsite =
    fallbackWebsite ??
    companyWebsite ??
    (resolvedDomain ? `https://${resolvedDomain.replace(/^https?:\/\//, '')}/` : null);
  const src: SourceAttribution = attribution({
    source: 'seamless',
    label:
      transport === 'mcp_streamable_http'
        ? 'Seamless.AI MCP company intelligence'
        : 'Seamless.AI',
    sourceUrl: resolvedWebsite ?? 'https://seamless.ai',
    fetchedAt: now,
    confidence: 0.9,
    providerMetadata: { transport, sourceTool },
  });

  return {
    legalName: company.name ?? fallbackName,
    tradeName: company.name ?? fallbackName,
    domain: resolvedDomain,
    website: resolvedWebsite,
    description: company.description ?? null,
    logoUrl: null,
    logoSource: null,
    imageUrl: null,
    employeeCount: typeof company.employeeCount === 'number' ? company.employeeCount : null,
    incorporationDate: toIso(company.foundedOn),
    industryLabels: Array.isArray(company.industries) ? company.industries.slice(0, 20) : [],
    confidenceBps: 9000,
    sourceAttribution: [src],
    providerMetadata: {
      seamless: {
        searchResultId: company.searchResultId ?? null,
        country: company.country ?? null,
        employeeCount: company.employeeCount ?? null,
        staffCountRange: company.staffCountRange ?? null,
        revenueRange: company.revenueRange ?? null,
        annualRevenue: company.annualRevenue ?? null,
        technologies: company.technologies ?? [],
        fundingTotal: company.fundingTotal ?? null,
        newsAndEvents: company.newsAndEvents ?? null,
        sicCode: company.sicCode ?? null,
        companyType: company.companyType ?? null,
        stockTicker: company.stockTicker ?? null,
        linkedInId: company.linkedInId ?? null,
        companyLIURL: company.companyLIURL ?? null,
        transport,
      },
    },
  };
}

/**
 * Enrich a company via Seamless.AI. Returns an OpenCompanyProfile (Seamless-
 * sourced) or null when no key is set, the call fails, or nothing matches.
 */
export async function fetchSeamlessCompany({
  name,
  domain,
  website,
  now = new Date(),
  apiKey = process.env.SEAMLESS_API_KEY,
  baseUrl = process.env.SEAMLESS_API_BASE_URL ?? DEFAULT_BASE_URL,
  mcpUrl = process.env.SEAMLESS_MCP_URL,
  mcpBearerToken = process.env.SEAMLESS_MCP_BEARER_TOKEN,
  mcpTool = process.env.SEAMLESS_MCP_SEARCH_COMPANIES_TOOL ?? DEFAULT_MCP_TOOL,
  mcpTimeoutMs = Number(process.env.SEAMLESS_MCP_TIMEOUT_MS ?? TIMEOUT_MS),
  fetchImpl = fetch,
}: {
  name: string;
  domain?: string | null;
  website?: string | null;
  now?: Date;
  apiKey?: string;
  baseUrl?: string;
  mcpUrl?: string;
  mcpBearerToken?: string;
  mcpTool?: string;
  mcpTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<OpenCompanyProfile | null> {
  if (!name.trim()) return null;

  if (mcpUrl) {
    const company = await fetchSeamlessMcpCompany({
      mcpUrl,
      mcpBearerToken,
      mcpTool,
      mcpTimeoutMs,
      name,
      domain,
      website,
      fetchImpl,
    }).catch(() => null);
    if (company) {
      return seamlessProfile({
        company,
        fallbackName: name,
        fallbackDomain: domain,
        fallbackWebsite: website,
        now,
        transport: 'mcp_streamable_http',
        sourceTool: mcpTool,
      });
    }
  }

  if (!apiKey) return null;

  let company: SeamlessCompany | undefined;
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/search/companies`, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Token: apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(
        domain ? { companyDomain: domain, limit: 1 } : { companyName: name, limit: 1 },
      ),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: SeamlessCompany[] };
    company = json.data?.[0];
  } catch {
    return null;
  }
  if (!company) return null;

  return seamlessProfile({
    company,
    fallbackName: name,
    fallbackDomain: domain,
    fallbackWebsite: website,
    now,
    transport: 'rest_api',
    sourceTool: '/search/companies',
  });
}

async function fetchSeamlessMcpCompany({
  mcpUrl,
  mcpBearerToken,
  mcpTool,
  mcpTimeoutMs,
  name,
  domain,
  website,
  fetchImpl,
}: {
  mcpUrl: string;
  mcpBearerToken?: string;
  mcpTool: string;
  mcpTimeoutMs: number;
  name: string;
  domain?: string | null;
  website?: string | null;
  fetchImpl: typeof fetch;
}): Promise<SeamlessCompany | null> {
  const client = new SeamlessMcpClient({
    url: mcpUrl,
    bearerToken: mcpBearerToken,
    timeoutMs: mcpTimeoutMs,
    fetchImpl,
  });
  const result = await client.callTool(mcpTool, {
    companyName: name,
    name,
    ...(domain ? { domain, companyDomain: domain, domains: [domain] } : {}),
    ...(website ? { website } : {}),
    limit: 5,
  });
  return pickSeamlessCompany(result, domain, name);
}

class SeamlessMcpClient {
  private sessionId: string | undefined;
  private initialized = false;
  private nextId = 1;

  constructor(
    private readonly options: {
      url: string;
      bearerToken?: string;
      timeoutMs: number;
      fetchImpl: typeof fetch;
    },
  ) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const raw = await this.rpc('tools/call', { name, arguments: args });
    const result = record(raw);
    if (result.isError === true) throw new Error(`Seamless MCP tool ${name} failed`);
    if (result.structuredContent !== undefined) return result.structuredContent;
    const content = rowsFromUnknown(result.content);
    const text = firstString(content[0] ?? {}, ['text']);
    if (!text) return raw;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'bidstack-seamless-client', version: '0.1.0' },
      },
      { skipInit: true },
    );
    this.initialized = true;
    await this.notify('notifications/initialized').catch(() => undefined);
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    opts: { skipInit?: boolean } = {},
  ): Promise<unknown> {
    if (!opts.skipInit) await this.initialize();
    const response = await this.postJsonRpc({ jsonrpc: '2.0', id: this.nextId++, method, params });
    const envelope = record(response);
    const error = record(envelope.error);
    if (error.message) throw new Error(String(error.message));
    return envelope.result;
  }

  private async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.postJsonRpc({ jsonrpc: '2.0', method, params }, true);
  }

  private async postJsonRpc(body: Record<string, unknown>, notification = false): Promise<unknown> {
    const response = await this.options.fetchImpl(this.options.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    const sessionId =
      response.headers.get('Mcp-Session-Id') ?? response.headers.get('mcp-session-id');
    if (sessionId && !this.sessionId) this.sessionId = sessionId;
    if (notification && response.status === 202) return undefined;
    if (!response.ok) throw new Error(`seamless-mcp HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) return readJsonFromEventStream(response);
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    };
    if (this.options.bearerToken) headers.Authorization = `Bearer ${this.options.bearerToken}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }
}

async function readJsonFromEventStream(response: Response): Promise<unknown> {
  const text = await response.text();
  const frames = text.split(/\n\n+/);
  for (const frame of frames.reverse()) {
    const dataLine = frame
      .split(/\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const payload = dataLine.slice('data:'.length).trim();
    if (!payload) continue;
    return JSON.parse(payload) as unknown;
  }
  throw new Error('seamless-mcp returned an empty event stream');
}
