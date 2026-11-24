import { describe, expect, it } from 'vitest';

import { autoMap, importTemplateCsv, TARGET_FIELDS } from './import-fields';

// A first import has no file to copy. The template's header row must be the
// labels the wizard already auto-maps, and the sample row must be obviously
// synthetic so it is not mistaken for a real account.
describe('importTemplateCsv', () => {
  it('gives every company column a header the wizard maps on its own', () => {
    const [header] = importTemplateCsv('company').trimEnd().split('\n');
    const headers = header.split(',');
    const mapped = autoMap(headers, TARGET_FIELDS.company);
    for (const field of TARGET_FIELDS.company) {
      expect(mapped[field.label]).toBe(field.key);
    }
  });

  it('uses one synthetic example row and no real company name', () => {
    const csv = importTemplateCsv('company');
    expect(csv).toContain('Harbor Synthetic');
    expect(csv).toContain('harbor-synthetic.example');
    expect(csv.toLowerCase()).not.toContain('mantu');
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('covers contacts, leads, opportunities, and financials the same way', () => {
    for (const entity of ['contact', 'lead', 'opportunity', 'financial'] as const) {
      const [header] = importTemplateCsv(entity).trimEnd().split('\n');
      const mapped = autoMap(header.split(','), TARGET_FIELDS[entity]);
      for (const field of TARGET_FIELDS[entity]) {
        expect(mapped[field.label], `${entity} ${field.label}`).toBe(field.key);
      }
    }
  });
});
