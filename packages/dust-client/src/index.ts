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

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface DustClientOptions {
  apiKey: string;
  workspaceId: string;
  baseUrl?: string;
  timeoutMs?: number;
  logger?: pino.Logger;
  /**
   * Outbound fetch implementation. baseUrl is org-admin-controlled, so server
   * callers MUST inject an SSRF-safe fetch (createSafeFetch from
   * '@bidstack/shared/server') that re-resolves DNS before every request —
   * the save-time string check alone doesn't survive DNS rebinding. Defaults
   * to the global fetch for tests and non-server contexts.
   */
  fetchImpl?: FetchLike;
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
  private readonly fetchImpl: FetchLike;

  constructor(opts: DustClientOptions) {
    if (!opts.apiKey) throw new Error('DustClient: apiKey required');
    if (!opts.workspaceId) throw new Error('DustClient: workspaceId required');
    this.apiKey = opts.apiKey;
    this.workspaceId = opts.workspaceId;
    this.baseUrl = opts.baseUrl ?? DUST_DEFAULT_BASE;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.log = opts.logger ?? pino({ name: 'dust-client' });
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
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

  async runAgent(
    agentId: string,
    message: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<DustAgentRun> {
    const data = await this.request<unknown>(
      'POST',
      `/v1/w/${this.workspaceId}/assistant/agent_configurations/${agentId}/runs`,
      { message: { content: message, role: 'user' } },
      0,
      opts.signal,
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
    externalSignal?: AbortSignal,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), this.timeoutMs);
    const abortFromExternal = () => ctl.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
      abortFromExternal();
    } else {
      externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    }

    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // Never auto-follow: 'follow' would replay the bearer token to an
        // arbitrary Location target and skip the injected SSRF-safe fetch's
        // per-request DNS gate (createSafeFetch rejects 'follow' outright).
        redirect: 'manual',
        signal: ctl.signal,
      });

      // Retry on 429 + 5xx with exponential backoff (max 3 attempts).
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
        this.log.warn({ status: res.status, wait, attempt }, 'dust retry');
        await sleep(wait, ctl.signal);
        return this.request<T>(method, path, body, attempt + 1, externalSignal);
      }

      // Refuse redirects instead of following them — a redirecting "Dust" host
      // is either misconfigured or trying to bounce the credentialed request
      // somewhere the DNS gate never validated.
      if (res.status >= 300 && res.status < 400) {
        this.log.error({ status: res.status, path }, 'dust redirect refused');
        throw new DustError(
          `Dust ${method} ${path} responded with a redirect (${res.status})`,
          res.status,
          null,
        );
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
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
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

  // Use Node's native crypto timingSafeEqual instead of a manual loop for robustness
  // We can assume crypto is available since this is a Node backend context.
  const cryptoModule = await import('node:crypto');
  return cryptoModule.timingSafeEqual(Buffer.from(hex), Buffer.from(expected));
}
