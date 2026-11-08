import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'CompanyDetailPage.tsx'), 'utf8');

describe('company detail keeps the employee count', () => {
  it('shows it in the intel strip for intel readers and in the header for everyone else', () => {
    expect(page).toMatch(/crmEmployees=\{c\.employeeCount/);
    expect(page).toMatch(/!canReadIntel && c\.employeeCount[\s\S]{0,200}companyDetail\.meta\.employees/);
  });

  it('keeps the activity charts next to the intel strip', () => {
    expect(page).toMatch(/<IntelStrip/);
    expect(page).toMatch(/<AccountActivityCharts companyId=\{c\.id\} \/>/);
  });
});
