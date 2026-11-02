/**
 * Server-side dry-run for CSV/XLSX import. No writes.
 * WHY: the wizard used to confirm only in the browser, so bad money/dates
 * surfaced after the worker had already started mutating the tenant.
 */

export type ImportPreviewEntity = 'company' | 'contact' | 'lead' | 'opportunity' | 'financial';

export interface ImportPreviewIssue {
  row: number;
  field: string | null;
  message: string;
}

export interface ImportPreviewResult {
  entityType: ImportPreviewEntity;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  issues: ImportPreviewIssue[];
  sample: Record<string, string>[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const CURRENCY_CODE_RE = /^[A-Za-z]{3}$/;
const MAX_MONEY_UNITS = 1_000_000_000_000;

const REQUIRED: Record<ImportPreviewEntity, string[]> = {
  company: ['company.name'],
  contact: ['contact.email'],
  lead: [],
  opportunity: ['opportunity.name', 'opportunity.customer'],
  financial: ['financial.companyName', 'financial.periodEnd', 'financial.currency'],
};

const MONEY_FIELDS = new Set([
  'opportunity.valueMicros',
  'financial.revenue',
  'financial.operatingIncome',
  'financial.netIncome',
]);

const DATE_FIELDS = new Set(['opportunity.closeDate', 'financial.periodEnd', 'financial.periodStart']);

export function parseMoneyUnits(raw: string): { ok: true; units: number } | { ok: false; reason: string } {
  const cleaned = raw.replace(/[, ]/g, '').replace(/^[€$£]/, '').trim();
  if (!cleaned || /^n\/?a$/i.test(cleaned) || cleaned === '-') {
    return { ok: false, reason: 'empty or n/a is not a number' };
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, reason: 'not a number' };
  if (n < 0) return { ok: false, reason: 'money cannot be negative' };
  if (n > MAX_MONEY_UNITS) return { ok: false, reason: 'exceeds 1e12 unit cap' };
  return { ok: true, units: n };
}

export function parseIsoDate(raw: string): { ok: true; iso: string } | { ok: false; reason: string } {
  const value = raw.trim();
  if (!ISO_DATE_RE.test(value) && !ISO_DATE_TIME_RE.test(value)) {
    return { ok: false, reason: 'use ISO-8601 YYYY-MM-DD' };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false, reason: 'invalid calendar date' };
  return { ok: true, iso: value.slice(0, 10) };
}

export function mappedValue(
  row: Record<string, string>,
  mappings: Record<string, string | null>,
  field: string,
): string {
  for (const [header, target] of Object.entries(mappings)) {
    if (target === field) return (row[header] ?? '').trim();
  }
  return '';
}

export function previewImportRows(input: {
  entityType: string;
  rows: Record<string, string>[];
  mappings: Record<string, string | null>;
}): ImportPreviewResult {
  const entityType = normalizePreviewEntity(input.entityType);
  if (!entityType) {
    return {
      entityType: 'company',
      rowCount: input.rows.length,
      validCount: 0,
      invalidCount: input.rows.length,
      issues: [{ row: 0, field: null, message: `Unsupported entity type "${input.entityType}"` }],
      sample: [],
    };
  }

  const issues: ImportPreviewIssue[] = [];
  let validCount = 0;

  input.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const before = issues.length;

    for (const field of REQUIRED[entityType]) {
      if (!mappedValue(row, input.mappings, field)) {
        issues.push({ row: rowNumber, field, message: 'required field is empty' });
      }
    }

    if (entityType === 'contact' || entityType === 'lead') {
      const emailField = entityType === 'contact' ? 'contact.email' : 'lead.email';
      const email = mappedValue(row, input.mappings, emailField);
      if (email && !EMAIL_RE.test(email)) {
        issues.push({ row: rowNumber, field: emailField, message: 'invalid email' });
      }
    }

    for (const field of MONEY_FIELDS) {
      const raw = mappedValue(row, input.mappings, field);
      if (!raw) continue;
      const parsed = parseMoneyUnits(raw);
      if (!parsed.ok) issues.push({ row: rowNumber, field, message: parsed.reason });
    }

    for (const field of DATE_FIELDS) {
      const raw = mappedValue(row, input.mappings, field);
      if (!raw) continue;
      const parsed = parseIsoDate(raw);
      if (!parsed.ok) issues.push({ row: rowNumber, field, message: parsed.reason });
    }

    if (entityType === 'financial') {
      const currency = mappedValue(row, input.mappings, 'financial.currency');
      if (currency && !CURRENCY_CODE_RE.test(currency)) {
        issues.push({
          row: rowNumber,
          field: 'financial.currency',
          message: 'currency must be a 3-letter ISO code',
        });
      }
      const periodType = mappedValue(row, input.mappings, 'financial.periodType');
      if (periodType && periodType !== 'FY' && periodType !== 'Q') {
        issues.push({
          row: rowNumber,
          field: 'financial.periodType',
          message: 'period type must be FY or Q',
        });
      }
    }

    if (issues.length === before) validCount += 1;
  });

  return {
    entityType,
    rowCount: input.rows.length,
    validCount,
    invalidCount: input.rows.length - validCount,
    issues: issues.slice(0, 50),
    sample: input.rows.slice(0, 5),
  };
}

export function normalizePreviewEntity(entityType: string): ImportPreviewEntity | null {
  const key = entityType.trim().toLowerCase();
  if (key === 'company' || key === 'companies' || key === 'account' || key === 'accounts') {
    return 'company';
  }
  if (key === 'contact' || key === 'contacts') return 'contact';
  if (key === 'lead' || key === 'leads') return 'lead';
  if (key === 'opportunity' || key === 'opportunities' || key === 'deal' || key === 'deals') {
    return 'opportunity';
  }
  if (key === 'financial' || key === 'financials') return 'financial';
  return null;
}
