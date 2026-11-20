/**
 * erp.helpers.ts — Zod schemas, exported types, and pure utility functions.
 *
 * Extracted from erp.service.ts (BS-R1 file-size refactor).
 * Consumed by erp.kit.service.ts and erp.partners.service.ts.
 * Import DAG: this file is the leaf — no @bidstack/db dependency.
 */
import { z } from 'zod';

// ─── Schemas ────────────────────────────────────────────────────────────────

export const ErpBidModule = z.object({
  id: z.string(),
  label: z.string(),
  erpModels: z.array(z.string()),
  bidstackSurface: z.string(),
  value: z.string(),
  status: z.enum(['ready', 'sidecar', 'planned']),
  availableTools: z.array(z.string()),
});

export const ErpPresalesKit = z.object({
  generatedAt: z.string().datetime(),
  configured: z.boolean(),
  reachable: z.boolean(),
  modules: z.array(ErpBidModule),
  partnerAutocomplete: z.object({
    inputs: z.array(z.string()),
    fallback: z.string(),
    validates: z.array(z.string()),
  }),
  fieldMap: z.array(
    z.object({
      erp: z.string(),
      bidstack: z.string(),
      mode: z.enum(['read', 'write', 'enrich']),
    }),
  ),
  nextActions: z.array(z.string()),
  lastError: z.string().nullable(),
});

export const ErpCompanySuggestion = z.object({
  id: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  domain: z.string().nullable(),
  website: z.string().nullable(),
  vat: z.string().nullable(),
  duns: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: z.enum(['external_erp', 'verified_data', 'external_crm', 'bidstack']),
  confidence: z.number().min(0).max(1),
  matchKeys: z.array(z.string()),
  sourceUrl: z.string().url().nullable(),
});

export const CompanyAutocompleteQuery = z.object({
  q: z.string().trim().max(255).optional(),
  domain: z.string().trim().max(255).optional(),
  vat: z.string().trim().max(100).optional(),
  duns: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(8),
});

export type CompanyAutocompleteInput = z.infer<typeof CompanyAutocompleteQuery>;
export type CompanySuggestion = z.infer<typeof ErpCompanySuggestion>;

// ─── Merge utility (exported for route layer) ───────────────────────────────

export function mergeSuggestions(...groups: CompanySuggestion[][]): CompanySuggestion[] {
  const byKey = new Map<string, CompanySuggestion>();
  for (const item of groups.flat()) {
    const key = item.domain ?? normalizeName(item.legalName ?? item.name);
    const existing = byKey.get(key);
    if (!existing || item.confidence > existing.confidence) byKey.set(key, item);
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
}

// ─── Low-level utilities (exported for partner search layer) ────────────────

export function normalizeRows(value: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.records)
      ? value.records
      : isRecord(value) && Array.isArray(value.rows)
        ? value.rows
        : isRecord(value) && Array.isArray(value.results)
          ? value.results
          : [];
  return rows.filter(isRecord);
}

// WHY private: callers only need the typed extraction helpers (rowString etc.),
// not the raw guard predicate.
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function rowString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[1] === 'string') return value[1].trim();
  return null;
}

export function rowNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function stringRegistry(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const direct = value[key];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const upper = value[key.toUpperCase()];
  if (typeof upper === 'string' && upper.trim()) return upper.trim();
  return null;
}

export function asUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw =
    value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const urlish =
    value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
  try {
    return new URL(urlish).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return value
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
  }
}

export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeToken(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// Sanitize an error message before sending it to the browser. We want the
// caller to see "ERP MCP unavailable" not the upstream URL (which may carry
// inline creds or a path token) and not a bearer string.
export function safeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error';
  const upstream = process.env.ERP_MCP_URL ?? process.env.ODOO_MCP_URL;
  let msg = err.message;
  if (upstream) msg = msg.split(upstream).join('[erp]');
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}
