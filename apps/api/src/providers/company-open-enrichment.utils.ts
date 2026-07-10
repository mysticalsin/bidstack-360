/**
 * company-open-enrichment.utils.ts — pure utility helpers for the Wikidata/Wikipedia
 * open-data enrichment provider.
 *
 * Extracted from company-open-enrichment.ts (BS-R1 file-size refactor).
 * Not part of the public API — imported only by company-open-enrichment.ts.
 */
import type { SourceAttribution } from '@bidstack/shared';

// Mirrors the FetchLike alias in company-open-enrichment.ts — kept local to
// avoid exporting an internal type.
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function commonsFileUrl(fileName: string): string {
  return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(fileName)}`;
}

export async function fetchJson<T>(
  input: string | URL,
  fetchImpl: FetchLike,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    headers.set(
      'User-Agent',
      process.env.BIDSTACK_USER_AGENT ?? 'PoloPreSales/0.1 (local development)',
    );
    const res = await fetchImpl(input, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function attribution({
  source,
  label,
  sourceUrl,
  fetchedAt,
  confidence,
  providerMetadata,
}: {
  source: string;
  label: string;
  sourceUrl: string;
  fetchedAt: Date;
  confidence: number;
  providerMetadata: Record<string, unknown>;
}): SourceAttribution {
  return {
    source,
    label,
    sourceUrl,
    fetchedAt: fetchedAt.toISOString(),
    confidence,
    providerMetadata,
  };
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
