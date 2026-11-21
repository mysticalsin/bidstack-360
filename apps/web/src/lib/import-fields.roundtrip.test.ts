import { describe, expect, it } from 'vitest';

import { autoMap, TARGET_FIELDS } from './import-fields';

describe('autoMap of the columns this app exports', () => {
  it('maps the companies CSV, including the legal name the export writes', () => {
    // Employees and Country are #432. Legal name is the column that export
    // writes and the importer still had no field for.
    const mapped = autoMap(
      ['Name', 'Legal Name', 'Domain', 'Industry', 'Employees', 'Country'],
      TARGET_FIELDS.company,
    );
    expect(mapped).toMatchObject({
      Name: 'company.name',
      'Legal Name': 'company.legalName',
      Domain: 'company.domain',
      Industry: 'company.industry',
      Employees: 'company.employeeCount',
      Country: 'company.countryCode',
    });
  });

  it('maps the contacts CSV role and customer onto title and company', () => {
    const mapped = autoMap(
      ['Name', 'Role', 'Customer', 'Email', 'Phone'],
      TARGET_FIELDS.contact,
    );
    expect(mapped).toMatchObject({
      Name: 'contact.name',
      Role: 'contact.title',
      Customer: 'contact.companyName',
      Email: 'contact.email',
      Phone: 'contact.phone',
    });
  });

  it('maps the leads export name and company', () => {
    const mapped = autoMap(['Name', 'Company', 'Email', 'Status'], TARGET_FIELDS.lead);
    expect(mapped).toMatchObject({
      Name: 'lead.name',
      Company: 'lead.companyName',
      Email: 'lead.email',
      Status: 'lead.status',
    });
  });

  it('maps the opportunities export value and due date', () => {
    const mapped = autoMap(
      ['Name', 'Customer', 'Stage', 'Value (EUR)', 'Probability', 'Due date'],
      TARGET_FIELDS.opportunity,
    );
    expect(mapped).toMatchObject({
      Name: 'opportunity.name',
      Customer: 'opportunity.customer',
      Stage: 'opportunity.stage',
      'Value (EUR)': 'opportunity.valueMicros',
      Probability: 'opportunity.probability',
      'Due date': 'opportunity.closeDate',
    });
  });
});
