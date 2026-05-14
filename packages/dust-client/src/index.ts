// Typed wrapper around the Dust workspace API.
// Reference: handoff/dust.integration.md
//
// Exposes:
//   - DustClient.listDocuments / getDocument / upsertDocument
//   - DustClient.runAgent
//   - DustClient.streamConversation
//
// Wraps every fetch with: bearer auth, exponential-backoff retry on 429/5xx,
// timeout (10s default), and Pino structured logging.

import pino from 'pino';
import { z } from 'zod';

export interface DustClientOptions {
  apiKey: string;
  workspaceId: string;
  baseUrl?: string;
  timeoutMs?: number;
  logger?: pino.Logger;
}

const DUST_DEFAULT_BASE = 'https://dust.tt/api';

export const DustDocument = z.object({
  document_id: z.string(),
  data_source_id: z.string(),
  hash: z.string().optional(),
  text_size: z.number().optional(),
  created: z.number().optional(),
  updated: z.number().optional(),
});
export type DustDocument = z.infer<typeof DustDocument>;

export const DustDocumentDetail = DustDocument.extend({
  text: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type DustDocumentDetail = z.infer<typeof DustDocumentDetail>;

export const DustAgentRun = z.object({
  run_id: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  output: z.string().nullable().optional(),
  conversation_id: z.string().nullable().optional(),
});
export type DustAgentRun = z.infer<typeof DustAgentRun>;

const DustAgentConfiguration = z
  .object({
    sId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

export const DustAgent = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable(),
});
export type DustAgent = z.infer<typeof DustAgent>;

export class DustError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'DustError';
  }
}

export class DustClient {
  private readonly apiKey: string;
  private readonly workspaceId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly log: pino.Logger;

  constructor(opts: DustClientOptions) {
    if (!opts.apiKey) throw new Error('DustClient: apiKey required');
    if (!opts.workspaceId) throw new Error('DustClient: workspaceId required');
    this.apiKey = opts.apiKey;
    this.workspaceId = opts.workspaceId;
    this.baseUrl = opts.baseUrl ?? DUST_DEFAULT_BASE;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.log = opts.logger ?? pino({ name: 'dust-client' });
  }

  async listDocuments(dataSourceId: string): Promise<DustDocument[]> {
    const data = await this.request<{ documents: unknown[] }>(
      'GET',
      `/v1/w/${this.workspaceId}/data_sources/${dataSourceId}/documents`,
    );
    return z.array(DustDocument).parse(data.documents);
  }

  async getDocument(dataSourceId: string, documentId: string): Promise<DustDocumentDetail> {
    const data = await this.request<{ document: unknown }>(
      'GET',
      `/v1/w/${this.workspaceId}/data_sources/${dataSourceId}/documents/${encodeURIComponent(documentId)}`,
    );
    return DustDocumentDetail.parse(data.document);
  }

  async listAgents(
    view: 'all' | 'list' | 'published' | 'global' | 'favorites' = 'list',
  ): Promise<DustAgent[]> {
    const data = await this.request<{ agentConfigurations?: unknown[] }>(
      'GET',
      `/v1/w/${this.workspaceId}/assistant/agent_configurations?view=${encodeURIComponent(view)}`,
    );
    const configurations = z.array(DustAgentConfiguration).parse(data.agentConfigurations ?? []);
    return configurations
      .map((agent) => {
        const id = agent.sId ?? agent.id ?? '';
        return {
          id,
          label: agent.name ?? agent.description ?? '(unnamed agent)',
          description: agent.description ?? null,
        };
      })
      .filter((agent): agent is DustAgent => DustAgent.safeParse(agent).success);
  }

  async upsertDocument(
    dataSourceId: string,
    documentId: string,
    text: string,
    metadata: Record<string, unknown> = {},
  ): Promise<DustDocument> {
    const data = await this.request<{ document: unknown }>(
      'POST',
      `/v1/w/${this.workspaceId}/data_sources/${dataSourceId}/documents`,
      { document_id: documentId, text, metadata },
    );
    return DustDocument.parse(data.document);
  }

  async runAgent(agentId: string, message: string): Promise<DustAgentRun> {
    const data = await this.request<unknown>(
      'POST',
      `/v1/w/${this.workspaceId}/assistant/agent_configurations/${agentId}/runs`,
      { message: { content: message, role: 'user' } },
    );
    return DustAgentRun.parse(data);
  }

  async getConversation(conversationId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET',
      `/v1/w/${this.workspaceId}/assistant/conversations/${conversationId}`,
    );
  }

  // Internal: fetch + retry + timeout + auth + structured logging.
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });

      // Retry on 429 + 5xx with exponential backoff (max 3 attempts).
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
        this.log.warn({ status: res.status, wait, attempt }, 'dust retry');
        await new Promise((r) => setTimeout(r, wait));
        return this.request<T>(method, path, body, attempt + 1);
      }

      const text = await res.text();
      const data = text ? (JSON.parse(text) as unknown) : ({} as unknown);

      if (!res.ok) {
        this.log.error({ status: res.status, path }, 'dust error');
        throw new DustError(`Dust ${method} ${path} failed with ${res.status}`, res.status, data);
      }

      return data as T;
    } catch (err) {
      if (err instanceof DustError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new DustError(`Dust ${method} ${path} timed out`, 408, null);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// HMAC verification helper for /webhooks/dust receivers.
// Constant-time comparison to thwart timing attacks.
export async function verifyDustSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = signatureHeader.slice('sha256='.length);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time compare
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) {
    diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
