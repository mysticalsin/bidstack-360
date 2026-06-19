import type { SourceAttribution } from '@bidstack/shared';

import { attribution } from './company-open-enrichment.utils.js';

const DEFAULT_TIMEOUT_MS = 12_000;
const MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_MCP_TOOL = 'detect_company_technologies';
const TECHNOLOGY_COLLECTION_KEYS = [
  'technologies',
  'technology',
  'detectedTechnologies',
  'detected_technologies',
  'techStack',
  'tech_stack',
  'stack',
  'tools',
  'products',
  'vendors',
  'software',
  'applications',
  'apps',
];

export interface TechStackMcpSourceConfig {
  id: string;
  label: string;
  url: string;
  bearerToken?: string;
  tool: string;
  timeoutMs: number;
}

export interface TechStackMcpProviderMetadata {
  technologies: string[];
  provider: string;
  transport: 'mcp_streamable_http';
  sourceTool: string;
}

export interface TechStackMcpProfile {
  technologies: string[];
  sourceAttribution: SourceAttribution[];
  providerMetadata: {
    techStackMcp: TechStackMcpProviderMetadata;
    techStackMcps: TechStackMcpProviderMetadata[];
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function rowsFromUnknown(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(record).filter((row) => Object.keys(row).length > 0);
  if (!value || typeof value !== 'object') return [];
  const root = record(value);
  for (const key of TECHNOLOGY_COLLECTION_KEYS) {
    const rows = rowsFromUnknown(root[key]);
    if (rows.length > 0) return rows;
  }
  for (const key of ['data', 'results', 'items', 'records']) {
    const rows = rowsFromUnknown(root[key]);
    if (rows.length > 0) return rows;
  }
  return Object.keys(root).length > 0 ? [root] : [];
}

function stringList(value: unknown, opts: { allowObjectMap?: boolean } = {}): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [item];
      const row = record(item);
      return [
        firstString(row, ['name', 'label', 'title', 'technology', 'vendor', 'product', 'service']) ??
          '',
      ];
    });
  }
  if (typeof value === 'string') {
    return value.split(/[,;|\n]/);
  }
  if (opts.allowObjectMap) {
    const root = record(value);
    const directName = firstString(root, [
      'name',
      'label',
      'title',
      'technology',
      'vendor',
      'product',
      'service',
    ]);
    if (directName) return [directName];
    return Object.entries(root).flatMap(([key, item]) => {
      const name =
        firstString(record(item), [
          'name',
          'label',
          'title',
          'technology',
          'vendor',
          'product',
          'service',
        ]) ?? key;
      return name;
    });
  }
  return [];
}

function uniqueTechnologyNames(value: unknown): string[] {
  const root = record(value);
  const rows = rowsFromUnknown(value);
  const technologyCollections = TECHNOLOGY_COLLECTION_KEYS.flatMap((key) =>
    stringList(root[key], { allowObjectMap: true }),
  );
  const candidates = [
    ...stringList(value),
    ...technologyCollections,
    ...rows.flatMap((row) => [
      firstString(row, ['name', 'label', 'title', 'technology', 'vendor', 'product', 'service']) ?? '',
      ...TECHNOLOGY_COLLECTION_KEYS.flatMap((key) =>
        stringList(row[key], { allowObjectMap: true }),
      ),
    ]),
  ];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of candidates) {
    const name = raw.trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names.slice(0, 30);
}

export async function fetchCompanyTechStackMcp({
  name,
  domain,
  website,
  now = new Date(),
  mcpUrl = process.env.TECH_STACK_MCP_URL,
  mcpBearerToken = process.env.TECH_STACK_MCP_BEARER_TOKEN,
  mcpTool = process.env.TECH_STACK_MCP_TOOL ?? DEFAULT_MCP_TOOL,
  mcpLabel = process.env.TECH_STACK_MCP_LABEL ?? 'Technology intelligence MCP',
  mcpTimeoutMs = Number(process.env.TECH_STACK_MCP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  fetchImpl = fetch,
}: {
  name: string;
  domain?: string | null;
  website?: string | null;
  now?: Date;
  mcpUrl?: string;
  mcpBearerToken?: string;
  mcpTool?: string;
  mcpLabel?: string;
  mcpTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<TechStackMcpProfile | null> {
  if (!name.trim() || !mcpUrl) return null;
  const client = new TechStackMcpClient({
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
    limit: 30,
  });
  const technologies = uniqueTechnologyNames(result);
  if (technologies.length === 0) return null;
  const sourceUrl = website ?? (domain ? `https://${domain.replace(/^https?:\/\//, '')}/` : mcpUrl);
  return {
    technologies,
    sourceAttribution: [
      attribution({
        source: 'tech_stack_mcp',
        label: mcpLabel,
        sourceUrl,
        fetchedAt: now,
        confidence: 0.86,
        providerMetadata: {
          transport: 'mcp_streamable_http',
          sourceTool: mcpTool,
          provider: mcpLabel,
        },
      }),
    ],
    providerMetadata: {
      techStackMcp: {
        technologies,
        provider: mcpLabel,
        transport: 'mcp_streamable_http',
        sourceTool: mcpTool,
      },
      techStackMcps: [
        {
          technologies,
          provider: mcpLabel,
          transport: 'mcp_streamable_http',
          sourceTool: mcpTool,
        },
      ],
    },
  };
}

export function techStackMcpSourceConfigsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TechStackMcpSourceConfig[] {
  const configs: TechStackMcpSourceConfig[] = [];
  const legacy = techStackMcpConfigFromValues({
    id: 'default',
    label: env.TECH_STACK_MCP_LABEL || 'Tech Intel MCP',
    url: env.TECH_STACK_MCP_URL,
    bearerToken: env.TECH_STACK_MCP_BEARER_TOKEN,
    tool: env.TECH_STACK_MCP_TOOL,
    timeoutMs: env.TECH_STACK_MCP_TIMEOUT_MS,
  });
  if (legacy) configs.push(legacy);

  const sourceIds = (env.TECH_STACK_MCP_SOURCE_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  for (const rawId of sourceIds) {
    const envId = rawId
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!envId) continue;
    const config = techStackMcpConfigFromValues({
      id: rawId,
      label: env[`TECH_STACK_MCP_${envId}_LABEL`] || titleFromSourceId(rawId),
      url: env[`TECH_STACK_MCP_${envId}_URL`],
      bearerToken: env[`TECH_STACK_MCP_${envId}_BEARER_TOKEN`],
      tool: env[`TECH_STACK_MCP_${envId}_TOOL`],
      timeoutMs: env[`TECH_STACK_MCP_${envId}_TIMEOUT_MS`],
    });
    if (config) configs.push(config);
  }

  const seen = new Set<string>();
  return configs.filter((config) => {
    const key = `${config.label.toLowerCase()}|${config.url}|${config.tool}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchCompanyTechStackMcps({
  name,
  domain,
  website,
  now = new Date(),
  configs = techStackMcpSourceConfigsFromEnv(),
  fetchImpl = fetch,
}: {
  name: string;
  domain?: string | null;
  website?: string | null;
  now?: Date;
  configs?: TechStackMcpSourceConfig[];
  fetchImpl?: typeof fetch;
}): Promise<TechStackMcpProfile | null> {
  const activeConfigs = configs.filter((config) => config.url);
  if (activeConfigs.length === 0) return null;
  const settled = await Promise.allSettled(
    activeConfigs.map((config) =>
      fetchCompanyTechStackMcp({
        name,
        domain,
        website,
        now,
        mcpUrl: config.url,
        mcpBearerToken: config.bearerToken,
        mcpTool: config.tool,
        mcpLabel: config.label,
        mcpTimeoutMs: config.timeoutMs,
        fetchImpl,
      }),
    ),
  );
  const profiles = settled.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : [],
  );
  if (profiles.length === 0) return null;
  const providerProfiles = profiles.flatMap((profile) => profile.providerMetadata.techStackMcps);
  const technologies = uniqueTechnologyNames(
    providerProfiles.flatMap((profile) => profile.technologies),
  );
  const firstProviderProfile = providerProfiles[0];
  const legacyProfile =
    providerProfiles.length === 1 && firstProviderProfile
      ? firstProviderProfile
      : {
          technologies,
          provider: `${providerProfiles.length} Tech Intel MCPs`,
          transport: 'mcp_streamable_http' as const,
          sourceTool: 'multiple',
        };

  return {
    technologies,
    sourceAttribution: profiles.flatMap((profile) => profile.sourceAttribution),
    providerMetadata: {
      techStackMcp: legacyProfile,
      techStackMcps: providerProfiles,
    },
  };
}

function techStackMcpConfigFromValues({
  id,
  label,
  url,
  bearerToken,
  tool,
  timeoutMs,
}: {
  id: string;
  label: string;
  url?: string;
  bearerToken?: string;
  tool?: string;
  timeoutMs?: string;
}): TechStackMcpSourceConfig | null {
  const trimmedUrl = url?.trim();
  if (!trimmedUrl) return null;
  const parsedTimeout = Number(timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    id: id.trim() || label,
    label: label.trim() || titleFromSourceId(id),
    url: trimmedUrl,
    bearerToken: bearerToken?.trim() || undefined,
    tool: tool?.trim() || DEFAULT_MCP_TOOL,
    timeoutMs:
      Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS,
  };
}

function titleFromSourceId(value: string): string {
  const words = value
    .trim()
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'Tech Intel MCP';
  return `${words
    .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')} MCP`;
}

class TechStackMcpClient {
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
    if (result.isError === true) throw new Error(`Tech stack MCP tool ${name} failed`);
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
        clientInfo: { name: 'bidstack-tech-stack-client', version: '0.1.0' },
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
    if (!response.ok) throw new Error(`tech-stack-mcp HTTP ${response.status}`);
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
  throw new Error('tech-stack-mcp returned an empty event stream');
}
