// InfoSearch MCP client — surfaces call lists / lead intel inside BidStack so
// managers stop visiting the platform separately. Pattern: a thin streamable-
// HTTP JSON-RPC client (same shape as packages/odoo-mcp-client, kept as an api
// lib since one route consumes it).
//
// Config rides INFOSEARCH_MCP_URL + INFOSEARCH_API_KEY behind the
// INFOSEARCH_ENABLED flag; when unset the feature hides gracefully.
//
// TODO(InfoSearch): confirm tool names + result shapes against the real
// InfoSearch MCP manifest when access is provisioned. Parsing below is
// defensive (passthrough, optional fields) so a richer payload won't break.
import { z } from 'zod';

import { getEnv } from '../env.js';

const INFOSEARCH_TIMEOUT_MS = 8000;

export class InfoSearchError extends Error {}

const LeadRow = z
  .object({
    id: z.string().optional(),
    name: z.string().default('Unknown contact'),
    company: z.string().nullish(),
    title: z.string().nullish(),
    phone: z.string().nullish(),
    email: z.string().nullish(),
    listName: z.string().nullish(),
  })
  .passthrough();

export interface InfoSearchLead {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  listName: string | null;
}

/**
 * Illustrative sample leads for the preview state (InfoSearch not configured).
 * Clearly sample — the route flags preview:true and the UI banners it.
 */
export function sampleInfoSearchLeads(account: string): InfoSearchLead[] {
  return [
    {
      id: 'sample-1',
      name: 'Jordan Avery',
      company: account,
      title: 'VP, Technology',
      phone: '+1 555 0142',
      email: 'jordan.avery@example.com',
      listName: 'Q3 outbound — enterprise',
    },
    {
      id: 'sample-2',
      name: 'Priya Nair',
      company: account,
      title: 'Director, Procurement',
      phone: '+1 555 0188',
      email: 'priya.nair@example.com',
      listName: 'Q3 outbound — enterprise',
    },
    {
      id: 'sample-3',
      name: 'Marc Olsen',
      company: account,
      title: 'Head of Security',
      phone: null,
      email: 'marc.olsen@example.com',
      listName: 'Security decision-makers',
    },
  ];
}

export function infosearchConfigured(): boolean {
  const env = getEnv();
  return (
    env.INFOSEARCH_ENABLED === 'true' && Boolean(env.INFOSEARCH_MCP_URL && env.INFOSEARCH_API_KEY)
  );
}

async function rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
  const env = getEnv();
  if (!infosearchConfigured()) throw new InfoSearchError('InfoSearch is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INFOSEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(env.INFOSEARCH_MCP_URL as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${env.INFOSEARCH_API_KEY}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new InfoSearchError(`InfoSearch responded ${res.status}`);
    const payload = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (payload.error) throw new InfoSearchError(payload.error.message ?? 'InfoSearch error');
    return payload.result;
  } catch (err) {
    if (err instanceof InfoSearchError) throw err;
    throw new InfoSearchError(
      err instanceof Error ? `InfoSearch unreachable: ${err.message}` : 'InfoSearch unreachable',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Call lists + lead intel for an account (company name match). */
export async function fetchInfoSearchLeads(account: string): Promise<InfoSearchLead[]> {
  const result = await rpc('tools/call', {
    name: 'search_leads',
    arguments: { query: account, limit: 25 },
  });
  const content =
    result && typeof result === 'object' && 'leads' in result
      ? (result as { leads: unknown }).leads
      : result;
  const rows = z.array(LeadRow).safeParse(Array.isArray(content) ? content : []);
  if (!rows.success) throw new InfoSearchError('InfoSearch returned an unexpected payload shape');
  return rows.data.map((row, index) => ({
    id: row.id ?? `${row.name}-${index}`,
    name: row.name,
    company: row.company ?? null,
    title: row.title ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    listName: row.listName ?? null,
  }));
}

/**
 * Activity logging (brief): when a manager views an account through
 * InfoSearch-backed UI, the event is reported back. Fire-and-forget — a
 * logging failure must never block the page.
 */
export function notifyInfoSearchActivity(input: {
  account: string;
  userEmail: string | null;
}): void {
  void rpc('tools/call', {
    name: 'log_activity',
    arguments: {
      event: 'account_viewed',
      account: input.account,
      actor: input.userEmail ?? 'unknown',
      source: 'bidstack',
      at: new Date().toISOString(),
    },
  }).catch(() => {
    // Silent by design — activity logging is best-effort.
  });
}
