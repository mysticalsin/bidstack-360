/**
 * Generic pure utilities shared across the monorepo.
 * No framework dependencies, no side effects.
 */

export function toNumber(value: bigint | number): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

export function pct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 10_000) / 100;
}

export function trendPercent(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Canonical account-key normalizer for cross-surface KAM joins.
 *
 * Governance / contract / cross-sell / project-ref tables key accounts on a
 * normalized name (free-text `accountKey`). KAM entities key on `Company.id`
 * (exact), but when a KPI must bridge to those legacy surfaces it derives the
 * key via THIS function — the single source of truth. Use it everywhere an
 * account name becomes a stable key; do not re-implement. Strips REPEATED
 * leading/trailing hyphens (strict variant) so names with leading/trailing
 * punctuation key identically. See docs/KAM-PLAN.md §1.
 */
export function normalizeAccountName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeCountry(country: string | null): string | null {
  if (!country) return null;
  const normalized = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((a.getTime() - b.getTime()) / msPerDay);
}

export function quarterStart(now = new Date()): Date {
  const q = Math.floor(now.getUTCMonth() / 3);
  return new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
}

export * from './webhook-url.js';
export * from './ssrf.js';
export * from './money.js';
