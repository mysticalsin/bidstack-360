import { describe, expect, it } from 'vitest';

import type { CrmCompany } from '@bidstack/shared';

import { buildCockpit } from './dashboard.cockpit.js';
import { formatMicrosCompact } from './dashboard.utils.js';

const UNITS_61520_MICROS = 61_520_000_000;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function company(annualRevenueMicros: number): CrmCompany {
  return {
    id: 'example-industrial',
    source: 'external_crm',
    name: 'Example Industrial',
    legalName: 'Example Industrial',
    domain: 'example.test',
    website: null,
    industry: 'Manufacturing',
    employeeCount: null,
    annualRevenueMicros,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    imageUrl: null,
    logo: null,
    technicalStack: [],
    confidence: 1,
    sourceAttribution: [],
    updatedAt: '2026-06-16T12:00:00.000Z',
  } as CrmCompany;
}

function annualRevenue(micros: number): string {
  const cockpit = buildCockpit({
    company: company(micros),
    companies: [],
    opportunities: [],
    contacts: [],
    tasks: [],
    risks: [],
    compliance: [],
  });
  return cockpit.kpis.find((kpi) => kpi.label === 'Annual revenue')?.value ?? '';
}

describe('cockpit annual revenue KPI under demo data', () => {
  it('does not price an annual revenue of 61520 as dollars', () => {
    // WHY: the cockpit Annual revenue tile prints company annualRevenueMicros.
    // That field does not store a currency. formatMicrosCompact prefixed a
    // dollar sign, so a demo figure of 61520 units read as a dollar forecast.
    // The figure stays 61520 and does not name a currency.
    const label = annualRevenue(UNITS_61520_MICROS);
    expect(label).not.toMatch(/EUR|€|\$|USD/);
    expect(digits(label)).toBe('61520');
  });

  it('keeps a half unit and does not invent a dollar zero when micros are not a safe integer', () => {
    // WHY: a half unit is still the stored amount. A micros value that is not
    // an integer is not a price, and it must not fall through to a dollar zero.
    const half = annualRevenue(61_520_500_000);
    expect(half.replace(/[^\d.]/g, '')).toBe('61520.5');
    expect(half).not.toMatch(/EUR|€|\$/);
    expect(formatMicrosCompact(Number.NaN)).toBe('Not a number');
    expect(formatMicrosCompact(1.5)).toBe('Not a number');
    expect(formatMicrosCompact(Number.NaN)).not.toMatch(/EUR|€|\$/);
  });
});
